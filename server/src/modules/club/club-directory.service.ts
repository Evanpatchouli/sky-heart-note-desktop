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
import { isDuplicateKey } from '../user-module/user-id';
import {
  CLUB_PERMISSIONS,
  CLUB_OPERATION_PERMISSIONS,
  isClubOperationPermission,
  type ClubPermission,
} from './club-permissions';
import type { UpdateCommissionRuleDto } from './club-pricing.dto';
import {
  Club, ClubMember, CLUB_ID, CLUB_LEADERSHIP_POSITIONS,
} from './club.schema';

@Injectable()
export class ClubDirectoryService implements OnModuleInit {
  constructor(
    @InjectModel(Club.name) private readonly clubs: Model<Club>,
    @InjectModel(ClubMember.name) private readonly members: Model<ClubMember>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly roles: RoleService,
  ) {}

  async onModuleInit() {
    await Promise.all([this.clubs.init(), this.members.init()]);
    const key = { _id: CLUB_ID };
    if (await this.clubs.exists(key)) return;
    const name = process.env.CLUB_NAME?.trim() || '送心手记';
    if (name.length > 80) throw new Error('CLUB_NAME 最多可配置 80 个字符');
    try {
      await this.clubs.updateOne(key, { $setOnInsert: { ...key, name } }, {
        upsert: true, runValidators: true,
      });
    } catch (error) {
      if (!isDuplicateKey(error, '_id') || !await this.clubs.exists(key)) throw error;
    }
  }

  async requireClub(clubId: string) {
    if (clubId !== CLUB_ID) throw new NotFoundException('俱乐部不存在');
    const club = await this.clubs.findById(clubId).select({ name: 1 }).lean();
    if (!club) throw new NotFoundException('俱乐部不存在');
    return club;
  }

  async getClientOrderOptions(clubId: string) {
    const club = await this.requireClub(clubId);
    const userIds = (await this.eligibleDispatchers(clubId)).sort();
    const nicknames = await this.memberNicknames(userIds);
    return {
      clubName: club.name,
      dispatchers: userIds.map((userId) => ({
        userId,
        nickname: nicknames.get(userId) ?? null,
      })),
    };
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
    return this.requirePermission(clubId, actor.id, permission);
  }

  private async requirePermission(clubId: string, userId: string, permission: ClubPermission) {
    await this.requireClub(clubId);
    const member = await this.members
      .findOne({ clubId, userId, active: true })
      .select({ position: 1, permissions: 1 })
      .lean();
    const permissions = member ? this.effectivePermissions(member) : [];
    if (!permissions.includes(permission)) {
      throw new ForbiddenException('需要本俱乐部有效成员身份及相应业务授权');
    }
    return permissions;
  }

  private effectivePermissions(member: Pick<ClubMember, 'permissions' | 'position'>) {
    return CLUB_PERMISSIONS.filter((permission) => member.permissions?.includes(permission) ||
      member.position === 'leader' && isClubOperationPermission(permission));
  }

  async getEmployeeClub(userId: string) {
    const [club, membership] = await Promise.all([
      this.requireClub(CLUB_ID),
      this.members.findOne({ clubId: CLUB_ID, userId, active: true }).lean(),
    ]);
    if (!membership) return null;
    return {
      name: club.name,
      canAssignPendingOrders: membership.position === 'leader' || membership.position === 'deputy',
      canDecideAdjustments: membership.position === 'leader' || membership.position === 'deputy',
      canManageAuthorizations: membership.position === 'leader',
      permissions: this.effectivePermissions(membership).filter(isClubOperationPermission),
    };
  }

  async requireAssignmentLeader(clubId: string, userId: string) {
    await this.requireClub(clubId);
    if (!(await this.members.exists({
      clubId, userId, active: true, position: { $in: CLUB_LEADERSHIP_POSITIONS },
    }))) {
      throw new ForbiddenException('仅本俱乐部团长或副团长可处理待分配订单');
    }
  }

  async listAssignmentCandidates(clubId: string, actorUserId: string) {
    await this.requireAssignmentLeader(clubId, actorUserId);
    const members = await this.members.find({ clubId, active: true })
      .select({ userId: 1, dispatcher: 1, _id: 0 })
      .sort({ dispatcher: -1, userId: 1 })
      .lean();
    const ids = await this.enabledAppUserIds('employee', members.map(({ userId }) => userId));
    const eligible = new Set(ids);
    const nicknames = await this.memberNicknames(ids);
    return members.filter(({ userId }) => eligible.has(userId)).map(({ userId, dispatcher }) => ({
      userId, dispatcher, nickname: nicknames.get(userId) ?? null,
    }));
  }

  async requireAssignmentCandidate(clubId: string, userId: string) {
    if (!(await this.members.exists({ clubId, userId, active: true })) ||
        !(await this.enabledAppUserIds('employee', [userId])).length) {
      throw new BadRequestException('请选择本俱乐部有效且可进入团员端的团员');
    }
  }

  async readCommissionRule(clubId: string) {
    const club = await this.clubs
      .findById(clubId)
      .select({ commissionRule: 1 })
      .lean();
    if (!club) throw new NotFoundException('俱乐部不存在');
    return club.commissionRule ?? null;
  }

  async getCommissionRule(clubId: string, actor: SessionUser) {
    await this.requirePermission(clubId, actor.id, 'CLUB_COMMISSION_MANAGE');
    return this.readCommissionRule(clubId);
  }

  async updateCommissionRule(
    clubId: string,
    actor: SessionUser,
    input: UpdateCommissionRuleDto,
  ) {
    await this.requirePermission(clubId, actor.id, 'CLUB_COMMISSION_MANAGE');
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

  async getAdminClub(actor: SessionUser) {
    this.requireAdminSession(actor);
    const [club, membership] = await Promise.all([
      this.requireClub(CLUB_ID),
      this.members.findOne({ clubId: CLUB_ID, userId: actor.id, active: true }).lean(),
    ]);
    return {
      name: club.name, permissions: membership ? this.effectivePermissions(membership) : [],
      canDecideAdjustments: membership?.position === 'leader' || membership?.position === 'deputy',
    };
  }

  async updateClubName(actor: SessionUser, name: string) {
    await this.requireLeader(actor.id);
    await this.clubs.updateOne({ _id: CLUB_ID }, { $set: { name } }, { runValidators: true });
    return { name };
  }

  async listMembers(clubId: string, actor: SessionUser) {
    await this.requirePermission(clubId, actor.id, 'CLUB_MEMBERS_MANAGE');
    const members = await this.members
      .find({ clubId })
      .select({ userId: 1, active: 1, dispatcher: 1, position: 1, _id: 0 })
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
    await this.requirePermission(clubId, actor.id, 'CLUB_MEMBERS_MANAGE');
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

  async eligibleGiftMembers(clubId: string) {
    return (await this.eligibleRecipients(clubId)).sort();
  }

  async eligibleRecipients(clubId: string) {
    const ids = await this.members.distinct('userId', {
      clubId,
      active: true,
    });
    return this.enabledAppUserIds('employee', ids);
  }

  async listDispatchRecipients(clubId: string, dispatcherUserId: string) {
    await this.requireMember(clubId, dispatcherUserId);
    const userIds = (await this.eligibleRecipients(clubId))
      .filter((id) => id !== dispatcherUserId)
      .sort();
    const nicknames = await this.memberNicknames(userIds);
    return userIds.map((userId) => ({
      userId,
      nickname: nicknames.get(userId) ?? null,
    }));
  }

  async initializeLeader(userId: string) {
    this.requireUserId(userId);
    const key = { clubId: CLUB_ID, userId };
    const leader = { clubId: CLUB_ID, position: 'leader' as const };
    await this.requireAssignmentAccount(userId);
    if (await this.members.exists({ ...key, position: 'leader' })) return;
    if (await this.members.exists(leader)) throw new ConflictException('已经初始化本俱乐部团长');
    try {
      await this.members.updateOne(key, {
        $set: { active: true, position: 'leader' },
        $setOnInsert: { ...key, dispatcher: false },
      }, { upsert: true, runValidators: true });
    } catch (error) {
      if (!isDuplicateKey(error, 'position') && !isDuplicateKey(error, 'userId')) throw error;
      if (await this.members.exists({ ...key, position: 'leader' })) return;
      throw new ConflictException('已经初始化本俱乐部团长');
    }
  }

  async setMembership(actor: SessionUser, userId: string, active: boolean) {
    await this.requirePermission(CLUB_ID, actor.id, 'CLUB_MEMBERS_MANAGE');
    this.requireUserId(userId);
    const key = { clubId: CLUB_ID, userId };
    if (active) {
      await this.requireAssignmentAccount(userId);
      try {
        await this.members.updateOne(key, {
          $set: { active: true },
          $setOnInsert: { ...key, dispatcher: false, position: 'member' },
        }, { upsert: true, runValidators: true });
      } catch (error) {
        if (!isDuplicateKey(error, 'userId') || !await this.members.exists({ ...key, active: true })) throw error;
      }
      return;
    }
    const result = await this.members.updateOne(
      { ...key, position: { $nin: CLUB_LEADERSHIP_POSITIONS } },
      { $set: { active: false, dispatcher: false, permissions: [], position: 'member' } },
    );
    if (!result.matchedCount) throw new ConflictException('只能停用本俱乐部的普通成员');
  }

  async listAuthorizations(actor: SessionUser) {
    await this.requireLeader(actor.id);
    const members = await this.members
      .find({ clubId: CLUB_ID, active: true }).sort({ userId: 1 }).lean();
    const ids = members.map(({ userId }) => userId);
    const [enabled, administrators, nicknames] = await Promise.all([
      this.enabledAppUserIds('employee', ids),
      this.enabledAppUserIds('admin', ids),
      this.memberNicknames(ids),
    ]);
    const eligible = new Set(enabled);
    const admins = new Set(administrators);
    return {
      permissions: CLUB_PERMISSIONS,
      members: members.filter(({ userId }) => eligible.has(userId)).map((member) => ({
        userId: member.userId,
        nickname: nicknames.get(member.userId) ?? null,
        position: member.position ?? 'member',
        permissions: this.effectivePermissions(member),
        grantablePermissions: (admins.has(member.userId) ? CLUB_PERMISSIONS : CLUB_OPERATION_PERMISSIONS)
          .filter((permission) => member.position !== 'leader' || !isClubOperationPermission(permission)),
      })),
    };
  }

  async setMemberDeputy(actor: SessionUser, userId: string, deputy: boolean) {
    await this.requireLeader(actor.id);
    this.requireUserId(userId);
    if (deputy) await this.requireAssignmentAccount(userId);
    const result = await this.members.updateOne(
      { clubId: CLUB_ID, userId, active: true, position: { $ne: 'leader' } },
      { $set: { position: deputy ? 'deputy' : 'member' } },
      { runValidators: true },
    );
    if (!result.matchedCount) throw new NotFoundException('本俱乐部可调整职务的有效成员不存在');
  }

  async setMemberPermission(actor: SessionUser, userId: string, permission: ClubPermission, granted: boolean) {
    await this.requireLeader(actor.id);
    this.requireUserId(userId);
    if (granted) {
      const app = isClubOperationPermission(permission) ? 'employee' : 'admin';
      if (!(await this.enabledAppUserIds(app, [userId])).length) {
        throw new BadRequestException(`授权对象须是拥有${app === 'admin' ? '管理端' : '团员端'}准入权限的有效平台账号`);
      }
    }
    const result = await this.members.updateOne(
      { clubId: CLUB_ID, userId, active: true, ...(isClubOperationPermission(permission) ? { position: { $ne: 'leader' } } : {}) },
      granted ? { $addToSet: { permissions: permission } } : { $pull: { permissions: permission } },
      { runValidators: true },
    );
    if (!result.matchedCount) throw new NotFoundException('本俱乐部可调整该权限的有效成员不存在');
  }

  private async requireLeader(userId: string) {
    if (!await this.members.exists({ clubId: CLUB_ID, userId, active: true, position: 'leader' })) {
      throw new ForbiddenException('仅本俱乐部团长可管理授权');
    }
  }

  private async requireAssignmentAccount(userId: string) {
    if (!(await this.enabledAppUserIds('employee', [userId])).length) {
      throw new BadRequestException('成员须是拥有团员端准入权限的有效平台账号');
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

  async memberNicknames(userIds: string[]) {
    if (!userIds.length) return new Map<string, string>();
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
