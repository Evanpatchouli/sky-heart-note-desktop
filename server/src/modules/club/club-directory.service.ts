import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { Model } from 'mongoose';
import {
  canAccess,
  type SessionUser,
  type WebApp,
} from '../../auth/app-access';
import { RoleService } from '../role-module/role.service';
import { User } from '../user-module/user.schema';
import {
  CLUB_PERMISSIONS,
  isClubPermission,
  type ClubPermission,
} from './club-permissions';
import type { UpdateCommissionRuleDto } from './club-pricing.dto';
import { Club, ClubMember, CLUB_ID_PATTERN } from './club.schema';

@Injectable()
export class ClubDirectoryService implements OnModuleInit {
  constructor(
    @InjectModel(Club.name) private readonly clubs: Model<Club>,
    @InjectModel(ClubMember.name) private readonly members: Model<ClubMember>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly roles: RoleService,
  ) {}

  async onModuleInit() {
    await this.members.init();
  }

  async requireClub(clubId: string) {
    if (!CLUB_ID_PATTERN.test(clubId))
      throw new BadRequestException('俱乐部标识格式无效');
    if (!(await this.clubs.exists({ _id: clubId })))
      throw new NotFoundException('俱乐部不存在');
  }

  async requireMember(clubId: string, userId: string) {
    await this.requireClub(clubId);
    if (!(await this.members.exists({ clubId, userId, active: true }))) {
      throw new ForbiddenException('需要本俱乐部有效成员身份');
    }
  }

  async requireAdminPermission(
    clubId: string,
    actor: SessionUser,
    permission: ClubPermission,
  ) {
    this.requireAdminSession(actor);
    await this.requireClub(clubId);
    const member = await this.members
      .findOne({
        clubId,
        userId: actor.id,
        active: true,
        permissions: permission,
      })
      .select({ permissions: 1 })
      .lean();
    if (!member) {
      throw new ForbiddenException('需要本俱乐部有效成员身份及相应业务授权');
    }
    return member.permissions;
  }

  async listEmployeeClubs(userId: string) {
    const clubIds = await this.members.distinct('clubId', {
      userId,
      active: true,
    });
    const clubs = await this.clubs
      .find({ _id: { $in: clubIds } })
      .select({ name: 1 })
      .sort({ _id: 1 })
      .lean();
    return clubs.map(({ _id, name }) => ({ id: _id, name }));
  }

  async readCommissionRule(clubId: string) {
    const club = await this.clubs
      .findById(clubId)
      .select({ commissionRule: 1 })
      .lean();
    if (!club) throw new NotFoundException('俱乐部不存在');
    return club.commissionRule ?? null;
  }

  async getAdminCommissionRule(clubId: string, actor: SessionUser) {
    await this.requireAdminPermission(clubId, actor, 'CLUB_COMMISSION_MANAGE');
    return this.readCommissionRule(clubId);
  }

  async updateCommissionRule(
    clubId: string,
    actor: SessionUser,
    input: UpdateCommissionRuleDto,
  ) {
    await this.requireAdminPermission(clubId, actor, 'CLUB_COMMISSION_MANAGE');
    const { expectedVersion, clubFeeCents } = input;
    const commissionRule = {
      version: expectedVersion + 1,
      basis: 'gift_times' as const,
      clubFeeCents,
    };
    const { matchedCount } = await this.clubs.updateOne(
      {
        _id: clubId,
        'commissionRule.version': expectedVersion || { $exists: false },
      },
      { $set: { commissionRule } },
      { runValidators: true },
    );
    if (!matchedCount)
      throw new ConflictException('抽成规则已更新，请重新加载后编辑');
    return commissionRule;
  }

  async listAdminClubs(actor: SessionUser) {
    this.requireAdminSession(actor);
    const memberships = await this.members
      .find({
        userId: actor.id,
        active: true,
        permissions: { $in: CLUB_PERMISSIONS },
      })
      .select({ clubId: 1, permissions: 1, _id: 0 })
      .lean();
    const clubs = await this.clubs
      .find({ _id: { $in: memberships.map(({ clubId }) => clubId) } })
      .sort({ _id: 1 })
      .lean();
    const permissionsByClub = new Map(
      memberships.map(({ clubId, permissions }) => [
        clubId,
        CLUB_PERMISSIONS.filter((permission) =>
          permissions.includes(permission),
        ),
      ]),
    );
    return clubs.map(({ _id, name }) => ({
      id: _id,
      name,
      permissions: permissionsByClub.get(_id),
    }));
  }

  async listAdminMembers(clubId: string, actor: SessionUser) {
    await this.requireAdminPermission(clubId, actor, 'CLUB_MEMBERS_MANAGE');
    const members = await this.members
      .find({ clubId })
      .select({ userId: 1, active: 1, dispatcher: 1, _id: 0 })
      .sort({ userId: 1 })
      .lean();
    const nicknames = await this.memberNicknames(
      members.map(({ userId }) => userId),
    );
    return members.map((member) => ({
      ...member,
      nickname: nicknames.get(member.userId) ?? null,
    }));
  }

  async setMemberDispatcher(
    clubId: string,
    actor: SessionUser,
    userId: string,
    dispatcher: boolean,
  ) {
    await this.requireAdminPermission(clubId, actor, 'CLUB_MEMBERS_MANAGE');
    this.requireUserId(userId);
    const member = await this.members
      .findOneAndUpdate(
        { clubId, userId, active: true },
        { $set: { dispatcher } },
        { returnDocument: 'after' },
      )
      .select({ userId: 1, active: 1, dispatcher: 1, _id: 0 })
      .lean();
    if (!member) throw new NotFoundException('本俱乐部有效成员不存在');
    const nicknames = await this.memberNicknames([userId]);
    return { ...member, nickname: nicknames.get(userId) ?? null };
  }

  async eligibleDispatchers(
    clubId: string,
    requestedUserId?: string,
  ): Promise<string[]> {
    const userIds = await this.members.distinct('userId', {
      clubId,
      active: true,
      dispatcher: true,
      ...(requestedUserId === undefined ? {} : { userId: requestedUserId }),
    });
    return this.enabledAppUserIds('employee', userIds);
  }

  async saveClub(clubId: string, name: string) {
    if (!CLUB_ID_PATTERN.test(clubId))
      throw new BadRequestException('俱乐部标识格式无效');
    if (!name.trim() || name.trim().length > 80)
      throw new BadRequestException('俱乐部名称必须为 1 至 80 个字符');
    await this.clubs.updateOne(
      { _id: clubId },
      { $set: { name } },
      { upsert: true, runValidators: true },
    );
  }

  async saveMember(
    clubId: string,
    userId: string,
    active: boolean,
    dispatcher: boolean,
  ) {
    await this.requireClub(clubId);
    this.requireUserId(userId);
    if (
      active &&
      !(await this.enabledAppUserIds('employee', [userId])).length
    ) {
      throw new BadRequestException('成员须是拥有团员端准入权限的有效平台账号');
    }
    const key = { clubId, userId };
    if (!active && !(await this.members.exists(key)))
      throw new NotFoundException('俱乐部成员不存在');
    await this.members.updateOne(
      key,
      { $set: { active, dispatcher, ...(active ? {} : { permissions: [] }) } },
      { upsert: active, runValidators: true },
    );
  }

  async setAdminPermission(
    clubId: string,
    userId: string,
    permission: ClubPermission,
    granted: boolean,
  ) {
    await this.requireClub(clubId);
    this.requireUserId(userId);
    if (!isClubPermission(permission))
      throw new BadRequestException('无效的俱乐部业务权限');
    if (granted && !(await this.enabledAppUserIds('admin', [userId])).length) {
      throw new BadRequestException(
        '授权对象须是拥有管理端准入权限的有效平台账号',
      );
    }
    const key = { clubId, userId };
    const { matchedCount } = granted
      ? await this.members.updateOne(
          { ...key, active: true },
          { $addToSet: { permissions: permission } },
          { runValidators: true },
        )
      : await this.members.updateOne(key, {
          $pull: { permissions: permission },
        });
    if (!matchedCount) {
      throw new NotFoundException(
        granted ? '本俱乐部有效成员不存在' : '俱乐部成员不存在',
      );
    }
  }

  private requireAdminSession(actor: SessionUser) {
    if (actor.app !== 'admin' || !canAccess('admin', actor.roles)) {
      throw new ForbiddenException('需要管理端会话');
    }
  }

  private requireUserId(userId: string) {
    if (!USER_ID_PATTERN.test(userId))
      throw new BadRequestException('请输入四位用户 ID');
  }

  private async memberNicknames(userIds: string[]) {
    const users = await this.users
      .find({ _id: { $in: userIds } })
      .select({ _id: 1, nickname: 1 })
      .lean();
    return new Map(users.map(({ _id, nickname }) => [_id, nickname]));
  }

  private async enabledAppUserIds(
    app: WebApp,
    userIds: string[],
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const allowedRoles = (await this.roles.findAll())
      .filter((role) => role.status === 1 && canAccess(app, [role.role_code]))
      .map((role) => role._id);
    return this.users.distinct('_id', {
      _id: { $in: userIds },
      role_ids: { $in: allowedRoles },
      deleted_at: null,
      status: 1,
    });
  }
}
