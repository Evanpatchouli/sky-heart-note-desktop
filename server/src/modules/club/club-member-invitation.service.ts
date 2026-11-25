import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { appOrigins } from '../../auth/app-access';
import { createOpaqueToken, digestToken, opaqueTokenPattern } from '../../auth/opaque-token';
import { hashPassword, matchesPassword } from '../../auth/password';
import { EVENTS } from '../../constants/events';
import UserCreatedEvent from '../../events/user.created.event';
import { RoleService } from '../role-module/role.service';
import { validateAccountCredentials } from '../user-module/account-credentials';
import { isDuplicateKey, withNewUserId } from '../user-module/user-id';
import { User } from '../user-module/user.schema';
import { ClubDirectoryService } from './club-directory.service';
import { CLUB_ID, ClubMember } from './club.schema';

@Schema({ collection: 'club_member_invitations', versionKey: false })
export class ClubMemberInvitation {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true, expires: '1d' })
  expiresAt: Date;

  @Prop({ type: String, required: true })
  clubId: string;

  @Prop({ type: String, required: true })
  inviterUserId: string;
}

export const ClubMemberInvitationSchema = SchemaFactory.createForClass(ClubMemberInvitation);

const lifetime = 24 * 60 * 60 * 1000;
const durable = { writeConcern: { w: 'majority', j: true } } as const;

@Injectable()
export class ClubMemberInvitationService implements OnModuleInit {
  constructor(
    @InjectModel(ClubMemberInvitation.name) private readonly invitations: Model<ClubMemberInvitation>,
    @InjectModel(ClubMember.name) private readonly members: Model<ClubMember>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly directory: ClubDirectoryService,
    private readonly roles: RoleService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async onModuleInit() {
    await Promise.all([this.invitations.init(), this.users.init()]);
  }

  async issue(clubId: string, userId: string) {
    await this.directory.requireMember(clubId, userId);
    await this.employeeRole();
    const token = createOpaqueToken();
    const expiresAt = Date.now() + lifetime;
    const invitationUrl = new URL('/join-club', appOrigins().client);
    invitationUrl.hash = new URLSearchParams({ token }).toString();
    await this.invitations.create({ tokenHash: digestToken(token), expiresAt: new Date(expiresAt),
      clubId, inviterUserId: userId });
    return { invitationUrl: invitationUrl.href, expiresAt };
  }

  async register(token: string, username: string, password: string) {
    if (!opaqueTokenPattern.test(token))
      throw new NotFoundException('注册邀请链接无效');
    const invitation = await this.invitations.findOne({ tokenHash: digestToken(token), clubId: CLUB_ID }).lean();
    if (!invitation) throw new NotFoundException('注册邀请链接无效');
    if (invitation.expiresAt.getTime() <= Date.now())
      throw new GoneException('注册邀请已过期，请联系团员重新邀请');
    await this.directory.requireAssignmentCandidate(invitation.clubId, invitation.inviterUserId);
    const role = await this.employeeRole();
    const login = validateAccountCredentials(username, password);
    const invitationScope = { clubInvitationId: invitation._id };
    const lookup = () => this.users.findOne(invitationScope).select('+password +clubInvitationConsumedAt').lean();
    let account = await lookup();
    if (!account) {
      const credential = await hashPassword(password);
      try {
        const created = await withNewUserId(_id => this.users.create({
          _id, username: login, password: credential, status: 0, role_ids: [role],
          register_at: Date.now(), ...invitationScope,
        }));
        account = created.toObject();
      } catch (error) {
        if (!isDuplicateKey(error, 'username') && !isDuplicateKey(error, 'clubInvitationId')) throw error;
        account = await lookup();
        if (!account) throw new ConflictException('用户名已被注册，请换一个用户名');
      }
    }
    if (account.status !== 0 || account.deleted_at !== null || account.clubInvitationConsumedAt ||
        account.username !== login || !await matchesPassword(password, account.password) ||
        account.role_ids.length !== 1 || !account.role_ids[0].equals(role)) {
      throw new ConflictException('注册邀请已使用。若刚才提交未收到结果，请使用设置的账号和密码登录');
    }

    // The account is disabled until its membership is durable. The unique invitation
    // on the account allows the matching credentials to finish after an interrupted write.
    const member = { clubId: invitation.clubId, userId: account._id };
    try {
      await this.members.updateOne(member,
        { $setOnInsert: { ...member, active: true, dispatcher: false, position: 'member', permissions: [] } },
        { ...durable, upsert: true, runValidators: true });
    } catch (error) {
      if (!isDuplicateKey(error, 'userId') || !await this.members.exists(member)) throw error;
    }
    if (!await this.members.exists({ ...member, active: true }))
      throw new ForbiddenException('俱乐部成员身份已停用');

    const { matchedCount } = await this.users.updateOne(
      { ...invitationScope, _id: account._id, status: 0, deleted_at: null, role_ids: [role], clubInvitationConsumedAt: null },
      { $set: { status: 1, clubInvitationConsumedAt: new Date() } }, durable,
    );
    if (matchedCount !== 1) throw new ConflictException('注册邀请已使用，请登录团员端');
    this.events?.emit(EVENTS.USER_CREATED, new UserCreatedEvent(account._id));
    return { id: account._id, clubId: invitation.clubId, employeeUrl: appOrigins().employee };
  }

  private async employeeRole() {
    const role = await this.roles.findByRoleCode('employee');
    if (!role || role.status !== 1)
      throw new ForbiddenException('平台团员角色已停用，暂无法邀请注册');
    return role._id;
  }
}
