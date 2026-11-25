import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { Model } from 'mongoose';
import { canAccess } from '../../auth/app-access';
import { RoleService } from '../role-module/role.service';
import { User } from '../user-module/user.schema';
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

  async listEmployeeClubs(userId: string) {
    const clubIds = await this.members.distinct('clubId', { userId, active: true });
    const clubs = await this.clubs.find({ _id: { $in: clubIds } }).select({ name: 1 }).sort({ _id: 1 }).lean();
    return clubs.map(({ _id, name }) => ({ id: _id, name }));
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
    return this.enabledEmployeeIds(userIds);
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
    if (!USER_ID_PATTERN.test(userId))
      throw new BadRequestException('请输入四位用户 ID');
    if (active && !(await this.enabledEmployeeIds([userId])).length) {
      throw new BadRequestException('成员须是拥有团员端准入权限的有效平台账号');
    }
    const key = { clubId, userId };
    if (!active && !(await this.members.exists(key)))
      throw new NotFoundException('俱乐部成员不存在');
    await this.members.updateOne(
      key,
      { $set: { active, dispatcher } },
      { upsert: active, runValidators: true },
    );
  }

  private async enabledEmployeeIds(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const allowedRoles = (await this.roles.findAll())
      .filter(
        (role) => role.status === 1 && canAccess('employee', [role.role_code]),
      )
      .map((role) => role._id);
    return this.users.distinct('_id', {
      _id: { $in: userIds },
      role_ids: { $in: allowedRoles },
      deleted_at: null,
      status: 1,
    });
  }
}
