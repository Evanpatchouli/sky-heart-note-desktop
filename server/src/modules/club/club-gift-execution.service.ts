import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftExecutionAccount } from '@webapp-template/common';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { EmployeeService } from '../employee/employee.service';
import { ClubDirectoryService } from './club-directory.service';
import type { GiftDispatchState, StoredGiftExecutionAccount, StoredGiftShare } from './club-gift-allocation';
import { ClubOrder } from './club-order.schema';

export const publishedGiftOrder = {
  dispatchStatus: 'published' as const,
  'dispatchPricing.priceUnit': 'gift_times',
};

export function giftHistoryScopes(clubId: string, userId: string): QueryFilter<ClubOrder>[] {
  return [
    { ...publishedGiftOrder, clubId, dispatchWithdrawnAt: null, 'giftDispatch.segments.shares.userId': userId },
    { ...publishedGiftOrder, clubId, 'giftDispatch.executionAccounts.userId': userId },
  ];
}

export const writableGiftDispatch = {
  ...publishedGiftOrder,
  dispatchWithdrawnAt: null,
  termination: null,
  'priceAdjustment.state': { $in: [null, 'continuing'] },
  giftPriceAdjustmentState: { $in: [null, 'continuing', 'superseded'] },
  closedAt: null,
};

export function acceptsGiftExecution(order: ClubOrder & {
  dispatchWithdrawnAt?: Date;
  termination?: unknown;
  priceAdjustment?: { state: string };
}) {
  return order.closedAt == null && order.dispatchWithdrawnAt == null && order.termination == null && !order.giftTermination &&
    (order.priceAdjustment?.state == null || order.priceAdjustment.state === 'continuing') &&
    (order.giftPriceAdjustmentState == null || order.giftPriceAdjustmentState === 'continuing' ||
      order.giftPriceAdjustmentState === 'superseded');
}

export function canProposeGiftPrice(order: ClubOrder) {
  return acceptsGiftExecution(order) || (order.giftPriceAdjustmentState === 'needs_requote' &&
    acceptsGiftExecution({ ...order, giftPriceAdjustmentState: undefined }));
}

export async function saveGiftDispatch(
  orders: Model<ClubOrder>, order: ClubOrder, scope: QueryFilter<ClubOrder>, state: GiftDispatchState,
) {
  const { modifiedCount } = await orders.updateOne({
    ...scope, _id: order._id, pendingDailyReport: null,
    fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
  }, { $set: { giftDispatch: state }, $inc: { fulfillmentRevision: 1 } }, { writeConcern: { w: 'majority', j: true } });
  return modifiedCount === 1;
}

function accountView({
  customerUserId: _customerUserId, customerNickname: _customerNickname, linkedAt, ...account
}: StoredGiftExecutionAccount): GiftExecutionAccount {
  return { ...account, linkedAt: linkedAt.toISOString() };
}

export function giftExecutionAccounts(order: ClubOrder, userId: string) {
  return (order.giftDispatch?.executionAccounts ?? []).filter(account => account.userId === userId).map(accountView);
}

function requireWritableShare(order: ClubOrder, share: StoredGiftShare) {
  if (!acceptsGiftExecution(order) || !share.days.some(day => day.dailyGiftTimes > 0)) {
    throw new ConflictException('本单或该份额已停止执行');
  }
  if (order.pendingDailyReport) throw new ServiceUnavailableException('履约正在更新，请重试本次操作');
}

const retry = () => new ServiceUnavailableException('订单分工或履约正在更新，请重试本次操作');

@Injectable()
export class ClubGiftExecutionService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly employee: EmployeeService,
  ) {}

  async linkAccount(clubId: string, userId: string, orderId: string, shareId: string, personalAccountId: string) {
    await this.directory.requireMember(clubId, userId);
    for (let attempt = 0; attempt < 16; attempt++) {
      const { order, state, share } = await this.getShare(clubId, userId, orderId, shareId);
      const accounts = state.executionAccounts ??= [];
      const prior = accounts.find(account => account.userId === userId &&
        account.personalAccountId === personalAccountId && account.recipientGameAccount === order.recipientGameAccount);
      if (prior?.shareIds.includes(share.id)) return accountView(prior);
      requireWritableShare(order, share);

      const personal = this.employee.findLinkableGameAccount(userId, personalAccountId);
      if (!personal) throw new NotFoundException('该个人送心号已不可用，请刷新后选择');
      if (prior) {
        prior.shareIds.push(share.id);
        if (await saveGiftDispatch(this.orders, order, writableGiftDispatch, state)) return accountView(prior);
        continue;
      }

      const customerUserId = order.customerUserId ?? null;
      const names = await this.directory.memberNicknames(customerUserId ? [userId, customerUserId] : [userId]);
      const account: StoredGiftExecutionAccount = {
        id: new Types.ObjectId().toHexString(),
        personalAccountId: personal.id,
        localAccountId: personal.localId,
        name: personal.name,
        linkedAt: new Date(),
        shareIds: [share.id],
        userId,
        memberNickname: names.get(userId) ?? null,
        customerUserId,
        customerNickname: (customerUserId && names.get(customerUserId)) || order.newCustomerNickname || order.customerLabel || null,
        recipientGameAccount: order.recipientGameAccount,
      };
      accounts.push(account);
      if (await saveGiftDispatch(this.orders, order, writableGiftDispatch, state)) return accountView(account);
    }
    throw retry();
  }

  private async getShare(clubId: string, userId: string, orderId: string, shareId: string) {
    if (!isObjectIdOrHexString(orderId) || !isObjectIdOrHexString(shareId)) {
      throw new BadRequestException('订单或承接份额标识格式无效');
    }
    const order = await this.orders.findOne({
      ...publishedGiftOrder, _id: orderId, clubId,
      'giftDispatch.segments.shares': { $elemMatch: { id: shareId.toLowerCase(), userId } },
    }).lean();
    const state = order?.giftDispatch;
    const share = state?.segments.flatMap(segment => segment.shares)
      .find(item => item.id === shareId.toLowerCase() && item.userId === userId);
    if (!order || !state || !share) throw new NotFoundException('该承接份额不存在');
    return { order, state, share };
  }
}
