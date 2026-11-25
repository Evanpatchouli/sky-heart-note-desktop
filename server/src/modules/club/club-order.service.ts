import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'node:crypto';
import { Model, QueryFilter, Types, isObjectIdOrHexString } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubCustomerService } from './club-customer.service';
import { UserDispatchActivationService } from '../user-module/user-dispatch-activation.service';
import { ClubDirectoryService } from './club-directory.service';
import type {
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
} from './club-order.dto';
import { ClubOrder } from './club-order.schema';

const incompleteCustomerLink = {
  newCustomerNickname: { $exists: true },
  customerLinkStatus: 'pending_verification',
};

type Submission =
  | { source: 'direct_dispatch'; input: CreateDirectOrderDto }
  | { source: 'client_order'; input: CreateClientOrderDto };

function orderSummary(order: ClubOrder) {
  return {
    id: order._id.toHexString(),
    clubId: order.clubId,
    source: order.source,
    businessType: order.businessType,
    recipientGameAccount: order.recipientGameAccount,
    requestedHearts: order.heartDelivery.requestedHearts,
    dispatcherUserId: order.dispatcherUserId,
    dispatcherAssignment: order.dispatcherAssignment,
    dispatchStatus: order.dispatchStatus,
    publishedAt: order.publishedAt ?? null,
    createdAt: order.createdAt,
  };
}

function orderOwnership(order: ClubOrder) {
  return {
    createdByUserId: order.createdByUserId,
    customerUserId: order.customerUserId ?? null,
    customerLinkStatus: order.customerLinkStatus,
    customerLabel: order.customerLabel ?? null,
  };
}

function shareSummary(share: ClubOrder['shares'][number]) {
  return {
    id: share._id.toHexString(),
    userId: share.userId,
    hearts: share.hearts,
  };
}

function adminOrderView(order: ClubOrder) {
  return {
    ...orderSummary(order),
    ...orderOwnership(order),
    shares: order.shares.map(shareSummary),
  };
}

function employeeView(order: ClubOrder, userId: string) {
  const dispatches = order.dispatcherUserId === userId;
  return {
    ...orderSummary(order),
    ...(dispatches ? orderOwnership(order) : {}),
    shares: order.shares
      .filter((share) => dispatches || share.userId === userId)
      .map((share) => ({
        ...shareSummary(share),
        ...(share.userId === userId
          ? {
              executionGameAccounts: share.executionGameAccounts.map(
                (account) => ({
                  id: account._id.toHexString(),
                  name: account.name,
                }),
              ),
            }
          : {}),
      })),
  };
}

@Injectable()
export class ClubOrderService implements OnModuleInit {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly customers: ClubCustomerService,
    private readonly activation: UserDispatchActivationService,
  ) {}

  async onModuleInit() {
    await this.orders.init();
  }

  async createDirectOrder(
    clubId: string,
    userId: string,
    input: CreateDirectOrderDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const identities = [input.existingCustomerUserId, input.newCustomerNickname, input.customerLabel];
    if (identities.filter(Boolean).length > 1)
      throw new BadRequestException('请选择已有用户或填写新老板昵称');

    const order = await this.create(clubId, userId, { source: 'direct_dispatch', input });
    return employeeView(await this.finishDirectCustomerLink(order), userId);
  }

  async searchDirectOrderCustomers(clubId: string, userId: string, query: string) {
    await this.directory.requireMember(clubId, userId);
    return this.customers.search(query);
  }

  async issueCustomerActivation(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    if (order.source !== 'direct_dispatch' || !order.newCustomerNickname ||
        order.customerLinkStatus !== 'verified' || !order.customerUserId) {
      throw new ConflictException('仅可从新老板的原建档订单生成激活链接');
    }
    return this.activation.issue(order.customerUserId, order._id);
  }

  private customerActivationOrders(orders: ClubOrder[], userId: string) {
    return this.activation.availableOrderIds(orders.flatMap((order) =>
      order.dispatcherUserId === userId && order.source === 'direct_dispatch' &&
        order.newCustomerNickname && order.customerLinkStatus === 'verified' && order.customerUserId
        ? [{ orderId: order._id, customerUserId: order.customerUserId }]
        : [],
    ));
  }

  private async finishDirectCustomerLink(order: ClubOrder) {
    if (!order.newCustomerNickname || order.customerLinkStatus === 'verified') return order;

    // MongoDB standalone has no multi-document transactions. Reserve the order's
    // request key first, then use its ID to recover the same account on retry.
    const customerUserId = await this.customers.createForOrder(order._id, order.newCustomerNickname);
    const saved = await this.orders.findOneAndUpdate(
      { _id: order._id, ...incompleteCustomerLink },
      { $set: { customerUserId, customerLinkStatus: 'verified' } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    return saved ?? this.get(order._id.toHexString(), { customerUserId, customerLinkStatus: 'verified' });
  }

  async createClientOrder(
    clubId: string,
    userId: string,
    input: CreateClientOrderDto,
  ) {
    await this.directory.requireClub(clubId);
    return orderSummary(
      await this.create(clubId, userId, { source: 'client_order', input }),
    );
  }

  async listCustomerOrders(
    clubId: string,
    userId: string,
    query: ClubOrderQuery,
  ) {
    await this.directory.requireClub(clubId);
    return this.customerOrdersPage(userId, query, clubId);
  }

  async listMyCustomerOrders(userId: string, query: ClubOrderQuery) {
    return this.customerOrdersPage(userId, query);
  }

  private async customerOrdersPage(userId: string, query: ClubOrderQuery, clubId?: string) {
    const { orders, nextCursor } = await this.list(
      { ...(clubId ? { clubId } : {}), customerUserId: userId, customerLinkStatus: 'verified' },
      query,
    );
    return { items: orders.map(orderSummary), nextCursor };
  }

  async getCustomerOrder(clubId: string, userId: string, orderId: string) {
    await this.directory.requireClub(clubId);
    return orderSummary(
      await this.get(orderId, {
        clubId,
        customerUserId: userId,
        customerLinkStatus: 'verified',
      }),
    );
  }

  async listEmployeeOrders(
    clubId: string,
    userId: string,
    query: ClubOrderQuery,
  ) {
    const scope = await this.employeeScope(clubId, userId);
    const { orders, nextCursor } = await this.list(scope, query);
    const activationOrders = await this.customerActivationOrders(orders, userId);
    return {
      items: orders.map((order) => ({
        ...employeeView(order, userId),
        ...(activationOrders.has(order._id.toHexString()) ? { customerActivationAvailable: true } : {}),
      })),
      nextCursor,
    };
  }

  async getEmployeeOrder(clubId: string, userId: string, orderId: string) {
    const scope = await this.employeeScope(clubId, userId);
    return employeeView(await this.get(orderId, scope), userId);
  }

  async listAdminOrders(
    clubId: string,
    actor: SessionUser,
    query: ClubOrderQuery,
  ) {
    await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_ORDERS_READ',
    );
    const { orders, nextCursor } = await this.list({ clubId }, query);
    return { items: orders.map(adminOrderView), nextCursor };
  }

  async getAdminOrder(clubId: string, actor: SessionUser, orderId: string) {
    await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_ORDERS_READ',
    );
    return adminOrderView(await this.get(orderId, { clubId }));
  }

  private async employeeScope(
    clubId: string,
    userId: string,
  ): Promise<QueryFilter<ClubOrder>> {
    await this.directory.requireMember(clubId, userId);
    return {
      clubId,
      $or: [
        { dispatcherUserId: userId },
        { dispatchStatus: 'published', 'shares.userId': userId },
      ],
    };
  }

  private async list(scope: QueryFilter<ClubOrder>, query: ClubOrderQuery) {
    const limit = query.limit ?? 25;
    const orders = await this.orders
      .find({
        ...scope,
        $nor: [incompleteCustomerLink],
        ...(query.source ? { source: query.source } : {}),
        ...(query.after
          ? { _id: { $lt: new Types.ObjectId(query.after) } }
          : {}),
      })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const nextCursor =
      orders.length > limit ? orders[limit - 1]._id.toHexString() : null;
    return { orders: orders.slice(0, limit), nextCursor };
  }

  private async get(orderId: string, scope: QueryFilter<ClubOrder>) {
    if (!isObjectIdOrHexString(orderId))
      throw new BadRequestException('订单标识格式无效');
    const order = await this.orders.findOne({ ...scope, _id: orderId, $nor: [incompleteCustomerLink] }).lean();
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  private async create(clubId: string, userId: string, submission: Submission) {
    const { source, input } = submission;
    const key = {
      clubId,
      source,
      createdByUserId: userId,
      requestId: input.requestId,
    };
    const existing = await this.orders.findOne(key).lean();
    if (existing) return this.checkReplay(existing, submission);

    if (submission.source === 'direct_dispatch' && submission.input.existingCustomerUserId) {
      await this.customers.requireExisting(submission.input.existingCustomerUserId);
    }

    const ownership =
      submission.source === 'direct_dispatch'
        ? {
            dispatcherUserId: userId,
            dispatcherAssignment: 'creator',
            dispatchStatus: 'draft',
            customerLinkStatus: submission.input.existingCustomerUserId ? 'verified' : 'pending_verification',
            customerLabel: submission.input.customerLabel,
            customerUserId: submission.input.existingCustomerUserId,
            selectedCustomerUserId: submission.input.existingCustomerUserId,
            newCustomerNickname: submission.input.newCustomerNickname,
          }
        : {
            dispatcherUserId: await this.resolveDispatcher(
              clubId,
              submission.input.dispatcherUserId,
            ),
            dispatcherAssignment: submission.input.dispatcherUserId
              ? 'customer_selected'
              : 'random',
            dispatchStatus: 'pending',
            customerUserId: userId,
            customerLinkStatus: 'verified',
          };

    try {
      return await this.orders.create({
        ...key,
        ...ownership,
        businessType: 'heart_delivery',
        recipientGameAccount: input.recipientGameAccount,
        heartDelivery: { requestedHearts: input.requestedHearts },
      });
    } catch (error) {
      if (!isDuplicateKey(error, 'requestId')) throw error;
      const saved = await this.orders.findOne(key).lean();
      if (!saved) throw error;
      return this.checkReplay(saved, submission);
    }
  }

  private async resolveDispatcher(clubId: string, requestedUserId?: string) {
    const candidates = await this.directory.eligibleDispatchers(
      clubId,
      requestedUserId,
    );
    if (!candidates.length) {
      if (requestedUserId)
        throw new BadRequestException('指定账号不在本俱乐部可选派单人范围内');
      throw new ConflictException('本俱乐部当前没有可选派单人，订单未创建');
    }
    return candidates[requestedUserId ? 0 : randomInt(candidates.length)];
  }

  private checkReplay(order: ClubOrder, submission: Submission) {
    const { input } = submission;
    const matchesSourceFields =
      submission.source === 'direct_dispatch'
        ? order.customerLabel === submission.input.customerLabel &&
          order.selectedCustomerUserId === submission.input.existingCustomerUserId &&
          order.newCustomerNickname === submission.input.newCustomerNickname
        : (order.dispatcherAssignment === 'customer_selected'
            ? order.dispatcherUserId
            : undefined) === submission.input.dispatcherUserId;
    if (
      !matchesSourceFields ||
      order.recipientGameAccount !== input.recipientGameAccount ||
      order.heartDelivery.requestedHearts !== input.requestedHearts
    ) {
      throw new ConflictException('相同提交标识已用于创建内容不同的订单');
    }
    return order;
  }
}
