import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftAccountRelationship, GiftExecutionAccount, GiftUnlockReview } from '@webapp-template/common';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { EmployeeService } from '../employee/employee.service';
import { ClubDirectoryService } from './club-directory.service';
import type { GiftDispatchState, StoredGiftExecutionAccount, StoredGiftShare } from './club-gift-allocation';
import { ClubOrder } from './club-order.schema';

export const publishedGiftOrder = {
  dispatchStatus: 'published' as const,
  'dispatchPricing.priceUnit': 'gift_times',
};

export const writableGiftDispatch = {
  ...publishedGiftOrder,
  dispatchWithdrawnAt: null,
  termination: null,
  'priceAdjustment.state': { $in: [null, 'continuing'] },
  closedAt: null,
};

export function acceptsGiftExecution(order: ClubOrder & {
  dispatchWithdrawnAt?: Date;
  termination?: unknown;
  priceAdjustment?: { state: string };
}) {
  return order.closedAt == null && order.dispatchWithdrawnAt == null && order.termination == null &&
    (order.priceAdjustment?.state == null || order.priceAdjustment.state === 'continuing');
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

function unitPrice(order: ClubOrder) {
  const terms = order.receipt?.quote.unlock ?? order.dispatchPricing?.unlock;
  if (!terms || !(terms.unitPriceAgreed ?? (terms.quantity > 0 || terms.unitPriceCents > 0))) return null;
  return terms.unitPriceCents;
}

function accountView({
  customerUserId: _customerUserId, customerNickname: _customerNickname, linkedAt, relationship, ...account
}: StoredGiftExecutionAccount): GiftExecutionAccount {
  return {
    ...account, linkedAt: linkedAt.toISOString(),
    relationship: relationship ? {
      ...relationship, occurredAt: relationship.occurredAt.toISOString(), recordedAt: relationship.recordedAt.toISOString(),
    } : null,
  };
}

export function giftExecutionAccounts(order: ClubOrder, userId: string) {
  return (order.giftDispatch?.executionAccounts ?? []).filter(account => account.userId === userId).map(accountView);
}

function unlockTotals(accounts: {
  relationship: { kind: GiftAccountRelationship; amountCents: number | null } | null;
}[]) {
  let actualCount = 0;
  let actualAmountCents = 0;
  let unpricedCount = 0;
  for (const { relationship } of accounts) {
    if (relationship?.kind !== 'new_unlock') continue;
    actualCount += 1;
    if (relationship.amountCents === null) unpricedCount += 1;
    else actualAmountCents += relationship.amountCents;
  }
  return { actualCount, actualAmountCents, unpricedCount };
}

export function giftExecutionSummary(order: ClubOrder, accounts: GiftExecutionAccount[]) {
  return {
    ...unlockTotals(accounts),
    agreedUnitPriceCents: unitPrice(order),
  };
}

export function giftUnlockReview(order: ClubOrder): GiftUnlockReview {
  const accounts = (order.giftDispatch?.executionAccounts ?? []).map(record => ({
    ...accountView(record), customerUserId: record.customerUserId, customerNickname: record.customerNickname,
  }));
  const byMember = new Map<string, GiftExecutionAccount[]>();
  for (const account of accounts) {
    const group = byMember.get(account.userId) ?? [];
    group.push(account);
    byMember.set(account.userId, group);
  }
  const summary = giftExecutionSummary(order, accounts);
  const quote = order.receipt?.quote;
  const estimatedAmountCents = quote?.unlockAmountCents ?? null;
  return {
    ...summary,
    estimatedAmountCents,
    estimatedCount: quote?.unlock.quantity ?? null,
    receivedAmountCents: order.receipt?.receivedAmountCents ?? null,
    differenceCents: estimatedAmountCents === null || summary.unpricedCount ? null : summary.actualAmountCents - estimatedAmountCents,
    recipientGameAccount: order.recipientGameAccount,
    records: accounts,
    members: [...byMember].map(([userId, group]) => ({
      userId, nickname: group[0].memberNickname, ...unlockTotals(group),
    })),
  };
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
        relationship: null,
      };
      accounts.push(account);
      if (await saveGiftDispatch(this.orders, order, writableGiftDispatch, state)) return accountView(account);
    }
    throw retry();
  }

  async recordRelationship(
    clubId: string, userId: string, orderId: string, shareId: string,
    accountId: string, kind: GiftAccountRelationship, occurredAt?: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    if (!isObjectIdOrHexString(accountId)) throw new BadRequestException('执行账号标识格式无效');
    const occurred = occurredAt ? new Date(occurredAt) : undefined;
    if (occurred && (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now())) {
      throw new BadRequestException('关系发生时间须为有效的已过去时间');
    }
    for (let attempt = 0; attempt < 16; attempt++) {
      const { order, state, share } = await this.getShare(clubId, userId, orderId, shareId);
      const accounts = state.executionAccounts ?? [];
      const account = accounts.find(item =>
        item.id === accountId.toLowerCase() && item.userId === userId && item.shareIds.includes(share.id));
      if (!account) throw new NotFoundException('该执行账号未关联到你的承接份额');
      if (account.relationship) {
        if (account.relationship.kind !== kind ||
            occurred && occurred.getTime() !== account.relationship.occurredAt.getTime()) {
          throw new ConflictException('该送心号的关系已登记，原记录已保留');
        }
        return accountView(account);
      }
      requireWritableShare(order, share);

      const amountCents = kind === 'existing_friend' ? 0 : unitPrice(order);
      if (amountCents !== null && amountCents > 0) {
        const { actualAmountCents } = unlockTotals(accounts);
        if (!Number.isSafeInteger(actualAmountCents + amountCents)) {
          throw new ConflictException('实际解锁费用超出可核对范围，请核对该单约定');
        }
      }
      const recordedAt = new Date();
      account.relationship = { kind, amountCents, occurredAt: occurred ?? recordedAt, recordedAt };
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
