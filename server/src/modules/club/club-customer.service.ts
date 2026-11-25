import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';
import { Model, Types, type PipelineStage } from 'mongoose';
import { canAccess } from '../../auth/app-access';
import { RoleService } from '../role-module/role.service';
import { isDuplicateKey, withNewUserId } from '../user-module/user-id';
import { User } from '../user-module/user.schema';
import { ClubOrder } from './club-order.schema';

type CustomerCandidate = { userId: string; nickname: string | null };

@Injectable()
export class ClubCustomerService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly roles: RoleService,
  ) {}

  async onModuleInit() {
    await this.users.init();
  }

  async search(query: string) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = new RegExp(escaped, 'i');
    const exact = new RegExp(`^${escaped}$`, 'i');
    const shortId = query.toUpperCase();
    const idMatch = USER_ID_PATTERN.test(shortId);
    return this.users.aggregate<CustomerCandidate>([
      { $match: { $or: [
        ...(idMatch ? [{ _id: shortId }] : []),
        { username: text },
        { nickname: text },
      ] } },
      ...await this.availableCustomers(),
      { $set: {
        exactId: { $eq: ['$_id', { $literal: shortId }] },
        exactUsername: { $regexMatch: { input: { $ifNull: ['$username', ''] }, regex: exact } },
        exactNickname: { $regexMatch: { input: { $ifNull: ['$nickname', ''] }, regex: exact } },
      } },
      { $sort: { exactId: -1, exactUsername: -1, exactNickname: -1, _id: 1 } },
      { $limit: 20 },
      { $project: { _id: 0, userId: '$_id', nickname: { $ifNull: ['$nickname', null] } } },
    ]).exec();
  }

  async requireExisting(userId: string) {
    const [customer] = await this.users.aggregate([
      { $match: { _id: userId } },
      ...await this.availableCustomers(),
      { $project: { _id: 1 } },
    ]).exec();
    if (!customer) throw new BadRequestException('请选择有效的平台用户');
  }

  async createForOrder(orderId: Types.ObjectId, nickname: string) {
    const key = { dispatchCustomerOrderId: orderId };
    const existing = await this.users.findOne(key).select({ _id: 1 }).lean();
    if (existing) return existing._id;

    const roleId = await this.roles.requireCommonRoleId();
    try {
      const customer = await withNewUserId((_id) => this.users.create({
        _id,
        ...key,
        nickname,
        role_ids: [roleId],
        register_at: Date.now(),
      }));
      return customer._id;
    } catch (error) {
      if (!isDuplicateKey(error, 'dispatchCustomerOrderId')) throw error;
      const saved = await this.users.findOne(key).select({ _id: 1 }).lean();
      if (!saved) throw error;
      return saved._id;
    }
  }

  private async availableCustomers(): Promise<PipelineStage[]> {
    const roleIds = (await this.roles.findAll())
      .filter(role => role.status === 1 && canAccess('client', [role.role_code]))
      .map(role => role._id);
    return [
      { $match: { _id: USER_ID_PATTERN, status: 1, deleted_at: null, role_ids: { $in: roleIds } } },
      // A provisional account becomes selectable when its originating order confirms the link.
      { $lookup: {
        from: this.orders.collection.name,
        localField: 'dispatchCustomerOrderId',
        foreignField: '_id',
        let: { customerId: '$_id' },
        pipeline: [{ $match: {
          source: 'direct_dispatch',
          customerLinkStatus: 'verified',
          $expr: { $eq: ['$customerUserId', '$$customerId'] },
        } }, { $project: { _id: 1 } }],
        as: 'linkedOrder',
      } },
      { $match: { $or: [
        { dispatchCustomerOrderId: { $exists: false } },
        { 'linkedOrder.0': { $exists: true } },
      ] } },
    ];
  }
}
