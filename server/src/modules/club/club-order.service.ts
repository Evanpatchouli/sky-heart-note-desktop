import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { calculateGiftQuote, calculateQuoteAmounts, estimateReceivedHearts, type CommissionRule, type ContinuationQuote, type CustomerQuote, type OrderPricing } from '@webapp-template/common';
import { randomInt } from 'node:crypto';
import { Model, QueryFilter, Types, isObjectIdOrHexString } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import { ClubCustomerService } from './club-customer.service';
import { UserDispatchActivationService } from '../user-module/user-dispatch-activation.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';
import { giftDispatchFingerprint, giftShareView } from './club-gift-allocation';
import type {
  AssignDispatcherDto,
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
  EmployeeClubOrderQuery,
} from './club-order.dto';
import type {
  AddContinuationQuoteDto,
  PublishOrderDto,
  RecordOrderReceiptDto,
  ReviewDispatchCommissionDto,
  UpdateOrderPricingDto,
} from './club-pricing.dto';
import type { StoredOrderReceipt } from './club-pricing.schema';
import { ClubOrder, type PendingAssignmentDecision } from './club-order.schema';

const clientOrderScope = {
  source: 'client_order',
  customerLinkStatus: 'verified',
} as const;

const incompleteCustomerLink = {
  newCustomerNickname: { $exists: true },
  customerLinkStatus: 'pending_verification',
};
const PRE_DISPATCH_STATUSES = ['draft', 'pending'];
const NO_UNLOCK = { quantity: 0, unitPriceCents: 0 };

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
    ...(order.heartDelivery.requestedGiftTimes === undefined
      ? { requestedHearts: order.heartDelivery.requestedHearts }
      : {
          requestedGiftTimes: order.heartDelivery.requestedGiftTimes,
          estimatedReceivedHearts: order.heartDelivery.estimatedReceivedHearts,
          doubleGiftTimes: order.heartDelivery.doubleGiftTimes,
        }),
    deliveryPeriodPreference: order.heartDelivery.deliveryPeriodPreference,
    dispatcherUserId: order.dispatcherUserId ?? null,
    dispatcherAssignment: order.dispatcherAssignment ?? null,
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

function assignmentResult(order: ClubOrder, decision: PendingAssignmentDecision) {
  return {
    id: order._id.toHexString(),
    clubId: order.clubId,
    dispatchStatus: decision.kind === 'assigned' ? 'pending' : 'cancelled',
    dispatcherUserId: decision.dispatcherUserId ?? null,
    dispatcherAssignment: decision.kind === 'assigned' ? 'manual' : null,
    decidedByUserId: decision.actorUserId,
    decidedAt: decision.decidedAt,
  };
}

function calculateCustomerQuote(pricing?: OrderPricing): CustomerQuote | null {
  if (!pricing) return null;
  const { revision, priceUnit, giftSegments, segments } = pricing;
  if (priceUnit !== 'gift_times') {
    const { unlock, discountedHeartsAmountCents } = pricing;
    if (!unlock) return null;
    const amounts = calculateQuoteAmounts(segments, unlock, discountedHeartsAmountCents);
    return amounts && { revision, segments, unlock, ...amounts };
  }
  const amounts = giftSegments && calculateGiftQuote(giftSegments);
  if (!amounts) return null;
  const unlock = pricing.unlock ?? NO_UNLOCK;
  const unlockAmountCents = unlock.quantity * unlock.unitPriceCents;
  const totalAmountCents = amounts.amountCents + unlockAmountCents;
  if (!Number.isSafeInteger(totalAmountCents)) return null;
  return {
    revision, priceUnit, giftSegments, segments, unlock,
    heartsAmountCents: amounts.amountCents, unlockAmountCents, totalAmountCents,
  };
}

function paymentStatus(receipt?: StoredOrderReceipt) {
  if (!receipt) return 'not_registered';
  if (receipt.receivedAmountCents < receipt.quote.totalAmountCents) return 'underpaid';
  if (receipt.receivedAmountCents > receipt.quote.totalAmountCents) return 'overpaid';
  return 'paid_in_full';
}

function dispatchPreparation(order: ClubOrder, rule: CommissionRule | null) {
  const quote = order.receipt?.quote ?? calculateCustomerQuote(order.pricing ?? order.dispatchPricing);
  return {
    pricing: order.pricing ?? null,
    rule,
    dispatchPricing: order.dispatchPricing ?? null,
    continuationQuotes: order.continuationQuotes ?? [],
    dispatchStatus: order.dispatchStatus,
    quote,
    receipt: order.receipt ?? null,
    commissionReview: order.commissionReview ?? null,
    paymentStatus: paymentStatus(order.receipt),
  };
}

function customerOrderView(order: ClubOrder, names: Map<string, string>) {
  const pricing = order.dispatchPricing ?? order.pricing;
  const segments = pricing?.segments;
  const giftSegments = pricing?.giftSegments;
  const quote = order.receipt?.quote ?? calculateCustomerQuote(pricing);
  return {
    ...orderSummary(order),
    dispatcherNickname: order.dispatcherUserId ? names.get(order.dispatcherUserId) ?? null : null,
    ...(pricing?.priceUnit === 'gift_times' ? { giftSegments } : segments ? { segments } : {}),
    ...(quote ? { quote } : {}),
    ...(order.receipt ? { receipt: {
      receivedAmountCents: order.receipt.receivedAmountCents,
      receivedAt: order.receipt.receivedAt,
    }, paymentStatus: paymentStatus(order.receipt) } : {}),
    ...(order.continuationQuotes?.length ? { continuationQuotes: order.continuationQuotes } : {}),
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
    ...(order.pendingAssignmentDecision
      ? { assignmentDecision: assignmentResult(order, order.pendingAssignmentDecision) }
      : {}),
    shares: order.shares.map(shareSummary),
  };
}

function employeeView(order: ClubOrder, userId: string) {
  const dispatches = order.dispatcherUserId === userId;
  return {
    ...orderSummary(order),
    ...(dispatches ? orderOwnership(order) : {}),
    ...(order.giftDispatch ? {
      giftShares: order.giftDispatch.segments.flatMap(({ segmentIndex, shares }) => shares
        .filter(share => dispatches || share.userId === userId)
        .map(share => ({ segmentIndex, ...giftShareView(share) }))),
    } : {}),
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
    private readonly giftDispatch: ClubGiftDispatchService,
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
    const order = await this.create(clubId, userId, { source: 'client_order', input });
    const names = await this.directory.memberNicknames(order.dispatcherUserId ? [order.dispatcherUserId] : []);
    return {
      ...orderSummary(order),
      dispatcherNickname: order.dispatcherUserId ? names.get(order.dispatcherUserId) ?? null : null,
    };
  }

  async listPendingAssignmentOrders(
    clubId: string,
    actorUserId: string,
    { after, limit }: ClubOrderQuery,
  ) {
    await this.directory.requireAssignmentLeader(clubId, actorUserId);
    const { orders, nextCursor } = await this.list(
      { ...clientOrderScope, clubId, dispatchStatus: 'pending_assignment' },
      { after, limit },
    );
    return { items: orders.map(orderSummary), nextCursor };
  }

  async assignPendingOrder(
    clubId: string,
    actorUserId: string,
    orderId: string,
    { requestId, dispatcherUserId }: AssignDispatcherDto,
  ) {
    await this.directory.requireAssignmentLeader(clubId, actorUserId);
    return this.decidePendingAssignment(
      orderId,
      { ...clientOrderScope, clubId },
      { kind: 'assigned', actorUserId, requestId, dispatcherUserId, decidedAt: new Date() },
    );
  }

  async cancelPendingOrder(clubId: string, userId: string, orderId: string, requestId: string) {
    await this.directory.requireClub(clubId);
    return this.decidePendingAssignment(
      orderId,
      { ...clientOrderScope, clubId, customerUserId: userId },
      { kind: 'cancelled', actorUserId: userId, requestId, decidedAt: new Date() },
    );
  }

  private async decidePendingAssignment(
    orderId: string,
    scope: QueryFilter<ClubOrder>,
    decision: PendingAssignmentDecision,
  ) {
    const order = await this.get(orderId, scope);
    if (order.dispatchStatus !== 'pending_assignment') return this.replayAssignment(order, decision);

    const { kind, dispatcherUserId } = decision;
    if (dispatcherUserId) await this.directory.requireAssignmentCandidate(order.clubId, dispatcherUserId);
    const updated = await this.orders.findOneAndUpdate(
      { ...scope, _id: orderId, dispatchStatus: 'pending_assignment' },
      {
        $set: {
          pendingAssignmentDecision: decision,
          dispatchStatus: kind === 'assigned' ? 'pending' : 'cancelled',
          ...(kind === 'assigned' ? { dispatcherUserId, dispatcherAssignment: 'manual' } : {}),
        },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    return updated
      ? assignmentResult(updated, decision)
      : this.replayAssignment(await this.get(orderId, scope), decision);
  }

  private replayAssignment(order: ClubOrder, decision: PendingAssignmentDecision) {
    const saved = order.pendingAssignmentDecision;
    if (saved?.kind === decision.kind && saved.requestId === decision.requestId &&
        saved.actorUserId === decision.actorUserId && saved.dispatcherUserId === decision.dispatcherUserId) {
      return assignmentResult(order, saved);
    }
    if (order.dispatchStatus === 'cancelled') {
      throw new ConflictException(decision.kind === 'assigned'
        ? '订单已由老板取消，分配未生效'
        : '订单已取消');
    }
    if (order.dispatcherUserId) {
      throw new ConflictException(decision.kind === 'assigned'
        ? '订单已有派单人，本次分配未生效'
        : '订单已分配，无法取消');
    }
    throw new ConflictException('订单当前不可分配或取消');
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
    const names = await this.directory.memberNicknames([
      ...new Set(orders.flatMap(({ dispatcherUserId }) => dispatcherUserId ? [dispatcherUserId] : [])),
    ]);
    return { items: orders.map(order => customerOrderView(order, names)), nextCursor };
  }

  async getCustomerOrder(clubId: string, userId: string, orderId: string) {
    await this.directory.requireClub(clubId);
    const order = await this.get(orderId, {
      clubId,
      customerUserId: userId,
      customerLinkStatus: 'verified',
    });
    const names = await this.directory.memberNicknames(order.dispatcherUserId ? [order.dispatcherUserId] : []);
    return customerOrderView(order, names);
  }

  async listEmployeeOrders(
    clubId: string,
    userId: string,
    query: EmployeeClubOrderQuery,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope =
      query.responsibility === 'dispatcher'
        ? { clubId, dispatcherUserId: userId }
        : this.employeeScope(clubId, userId);
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
    await this.directory.requireMember(clubId, userId);
    const scope = this.employeeScope(clubId, userId);
    return employeeView(await this.get(orderId, scope), userId);
  }

  async getDispatchPreparation(
    clubId: string,
    userId: string,
    orderId: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    const rule = order.dispatchStatus === 'published' ? null : await this.directory.readCommissionRule(clubId);
    return dispatchPreparation(order, rule);
  }

  async addContinuationQuote(
    clubId: string,
    userId: string,
    orderId: string,
    { requestId, segment }: AddContinuationQuoteDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    const pricing = order.dispatchPricing;
    if (order.dispatchStatus !== 'published' || pricing?.priceUnit !== 'gift_times') {
      throw new ConflictException('仅已派发的按次订单可追加报价');
    }

    const amounts = calculateGiftQuote([segment]);
    if (!amounts) throw new BadRequestException('请核对续段的赠送次数、日量和单价');
    const quote: ContinuationQuote = { requestId, segment, amountCents: amounts.amountCents };
    const { version, basis, clubFeeCents, dispatchFeeCents } = pricing;
    const commission = { version, basis, clubFeeCents, dispatchFeeCents };
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope,
        _id: order._id,
        dispatchStatus: 'published',
        'dispatchPricing.priceUnit': 'gift_times',
        'continuationQuotes.requestId': { $ne: requestId },
      },
      { $push: { continuationQuotes: quote } },
      { runValidators: true },
    );
    if (matchedCount) return { ...quote, commission };

    const latest = await this.get(orderId, scope);
    const saved = latest.continuationQuotes?.find(item => item.requestId === requestId);
    if (
      saved?.segment.period !== segment.period ||
      saved.segment.paidGiftTimes !== segment.paidGiftTimes ||
      saved.segment.dailyGiftTimes !== segment.dailyGiftTimes ||
      saved.segment.unitPriceCents !== segment.unitPriceCents
    ) throw new ConflictException('相同提交标识已用于不同的续段报价，或订单状态已更新');
    return { ...saved, commission };
  }

  async updateDispatchPricing(
    clubId: string,
    userId: string,
    orderId: string,
    input: UpdateOrderPricingDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (order.dispatchStatus === 'published')
      throw new ConflictException('订单已派发');
    if (order.receipt) throw new ConflictException('已登记实收，原报价已保留');

    const rule = await this.requireCurrentRule(clubId, input.ruleVersion);
    const amounts = calculateGiftQuote(input.giftSegments);
    const requested = order.heartDelivery.requestedGiftTimes;
    if (requested === undefined) {
      throw new ConflictException('历史订单按原订购颗数保留，无法写入按次报价');
    }
    if (!amounts || amounts.paidGiftTimes !== requested) {
      throw new BadRequestException('各报价段付费次数合计须等于原订购次数，请核对每日次数和金额');
    }

    const pricing = {
      basis: 'gift_times' as const,
      ruleVersion: rule.version,
      priceUnit: 'gift_times' as const,
      dispatchFeeCents: input.dispatchFeeCents,
      segments: [],
      unlock: input.unlock ?? order.pricing?.unlock ?? NO_UNLOCK,
      giftSegments: input.giftSegments,
      revision: input.expectedRevision + 1,
    };
    if (!calculateCustomerQuote(pricing))
      throw new BadRequestException('报价金额超出可记录范围');
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope,
        _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        'pricing.revision': input.expectedRevision || { $exists: false },
        receipt: { $exists: false },
      },
      { $set: { pricing } },
      { runValidators: true },
    );
    if (!matchedCount)
      throw new ConflictException('订单报价或派发状态已更新，请重新加载');
    return dispatchPreparation({ ...order, pricing }, rule);
  }

  async recordOrderReceipt(clubId: string, userId: string, orderId: string, input: RecordOrderReceiptDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    const receivedAt = new Date(input.receivedAt);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new BadRequestException('实收时间格式无效');
    if (order.receipt) return this.replayOrderReceipt(order.receipt, input, receivedAt);

    const quote = calculateCustomerQuote(order.pricing);
    if (order.dispatchStatus === 'published' || quote?.priceUnit !== 'gift_times' || quote.revision !== input.pricingRevision)
      throw new ConflictException('请重新加载并核对最新报价后登记实收');
    const receipt: StoredOrderReceipt = {
      requestId: input.requestId,
      receivedAmountCents: input.receivedAmountCents,
      receivedByUserId: userId,
      recordedByUserId: userId,
      receivedAt,
      recordedAt: new Date(),
      quote,
    };
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope, _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        'pricing.revision': quote.revision,
        receipt: { $exists: false },
      },
      { $set: { receipt } },
      { runValidators: true },
    );
    if (matchedCount) return { receipt, paymentStatus: paymentStatus(receipt) };
    const latest = await this.get(orderId, scope);
    if (latest.receipt) return this.replayOrderReceipt(latest.receipt, input, receivedAt);
    throw new ConflictException('报价或派发状态已更新，请重新加载后核对实收');
  }

  private replayOrderReceipt(receipt: StoredOrderReceipt, input: RecordOrderReceiptDto, receivedAt: Date) {
    if (
      receipt.requestId !== input.requestId ||
      receipt.quote.revision !== input.pricingRevision ||
      receipt.receivedAmountCents !== input.receivedAmountCents ||
      receipt.receivedAt.getTime() !== receivedAt.getTime()
    ) throw new ConflictException('本单已有不同的实收登记，请重新加载核对');
    return { receipt, paymentStatus: paymentStatus(receipt) };
  }

  async reviewDispatchCommission(clubId: string, userId: string, orderId: string, input: ReviewDispatchCommissionDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (order.dispatchStatus === 'published' || order.receipt?.quote.revision !== input.pricingRevision)
      throw new ConflictException('请核对已登记实收的报价版本和派发状态');

    const rule = await this.requireCurrentRule(clubId, input.ruleVersion);
    const commissionReview = {
      revision: input.expectedReviewRevision + 1,
      ruleVersion: rule.version,
      basis: 'gift_times' as const,
      dispatchFeeCents: input.dispatchFeeCents,
    };
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope, _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        'receipt.quote.revision': input.pricingRevision,
        'commissionReview.revision': input.expectedReviewRevision || { $exists: false },
      },
      { $set: { commissionReview } },
      { runValidators: true },
    );
    if (!matchedCount) throw new ConflictException('派抽复核或派发状态已更新，请重新加载');
    return dispatchPreparation({ ...order, commissionReview }, rule);
  }

  async commitDispatchAfterPayment(clubId: string, userId: string, orderId: string, input: PublishOrderDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (order.dispatchStatus === 'published') return this.replayDispatch(order, input);

    const { requestId, pricingRevision, ruleVersion, commissionReviewRevision } = input;
    const { pricing, receipt, commissionReview } = order;
    if (pricing?.priceUnit !== 'gift_times' || pricing.revision !== pricingRevision ||
        receipt?.quote.priceUnit !== 'gift_times' || receipt.quote.revision !== pricingRevision) {
      throw new ConflictException('订单报价未准备或已更新，请重新确认');
    }
    if (paymentStatus(receipt) !== 'paid_in_full')
      throw new ConflictException('实收与报价的差额待核对');
    if ((commissionReview?.revision ?? 0) !== commissionReviewRevision)
      throw new ConflictException('派抽复核已更新，请重新加载');
    const commission = commissionReview ?? pricing;
    const rule = await this.requireCurrentRule(clubId, ruleVersion);
    if (commission.basis !== rule.basis || commission.ruleVersion !== ruleVersion)
      throw new ConflictException('请重新核对最新的每次抽成规则');

    const { revision, priceUnit, giftSegments, segments, unlock, totalAmountCents } = receipt.quote;
    const giftDispatch = input.giftDispatchSegments
      ? await this.giftDispatch.prepareInitial(clubId, input.giftDispatchSegments, giftSegments ?? [])
      : undefined;
    const dispatchPricing = {
      ...rule, revision, priceUnit, giftSegments, segments, unlock,
      dispatchFeeCents: commission.dispatchFeeCents,
    };
    const committed = await this.orders.findOneAndUpdate(
      {
        ...scope, _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        'pricing.revision': pricingRevision,
        'receipt.quote.revision': pricingRevision,
        'receipt.receivedAmountCents': totalAmountCents,
        'commissionReview.revision': commissionReviewRevision || { $exists: false },
        dispatchPricing: { $exists: false },
      },
      {
        $set: {
          dispatchStatus: 'published', publishedAt: new Date(), dispatchPricing,
          giftPublicationRequestId: requestId,
          ...(giftDispatch ? { giftDispatch, giftPublicationScheduleFingerprint: giftDispatchFingerprint(input.giftDispatchSegments!) } : {}),
        },
        $unset: { pricing: '' },
      },
      { returnDocument: 'after', runValidators: true, writeConcern: { w: 'majority', j: true } },
    ).lean();
    if (committed) return this.dispatchReceipt(committed);
    const latest = await this.get(orderId, scope);
    if (latest.dispatchStatus === 'published') return this.replayDispatch(latest, input);
    throw new ConflictException('订单报价或派发状态已更新，请重新加载');
  }

  private dispatchReceipt(order: ClubOrder) {
    return { ...orderSummary(order), dispatchPricing: order.dispatchPricing };
  }

  private replayDispatch(order: ClubOrder, input: PublishOrderDto) {
    if (
      order.giftPublicationRequestId !== input.requestId ||
      order.dispatchPricing?.revision !== input.pricingRevision ||
      order.dispatchPricing.version !== input.ruleVersion ||
      (order.commissionReview?.revision ?? 0) !== input.commissionReviewRevision ||
      order.giftPublicationScheduleFingerprint !== (input.giftDispatchSegments && giftDispatchFingerprint(input.giftDispatchSegments))
    ) throw new ConflictException('订单已派发，提交标识或派发内容不同');
    return this.dispatchReceipt(order);
  }

  private async requireCurrentRule(clubId: string, reviewedVersion: number) {
    const rule = await this.directory.readCommissionRule(clubId);
    if (!rule) throw new ConflictException('俱乐部尚未配置抽成规则');
    if (rule.basis !== 'gift_times') {
      throw new ConflictException('请由有权限的管理员保存每次团抽规则后再继续');
    }
    if (rule.version !== reviewedVersion) {
      throw new ConflictException('抽成规则已更新，请重新加载后确认');
    }
    return rule;
  }

  async listAdminDispatchPricing(
    clubId: string,
    actor: SessionUser,
    query: ClubOrderQuery,
  ) {
    const permissions = await this.directory.requireAdminPermission(
      clubId,
      actor,
      'CLUB_ORDERS_READ',
    );
    if (!permissions.includes('CLUB_COMMISSION_MANAGE')) {
      throw new ForbiddenException('查看规则快照需要本俱乐部抽成配置权限');
    }
    const canReadFinance = permissions.includes('CLUB_FINANCE_READ');
    const { orders, nextCursor } = await this.list(
      {
        clubId,
        dispatchStatus: 'published',
        'dispatchPricing.version': { $exists: true },
      },
      query,
    );
    const items = orders.flatMap(
      ({ _id, source, dispatcherUserId, publishedAt, dispatchPricing }) => {
        if (!dispatchPricing) return [];
        const { version, basis, clubFeeCents, dispatchFeeCents, segments, priceUnit, giftSegments } =
          dispatchPricing;
        return [
          {
            id: _id.toHexString(),
            source,
            dispatcherUserId,
            publishedAt,
            version,
            basis,
            clubFeeCents,
            ...(canReadFinance ? {
              dispatchFeeCents,
              ...(priceUnit === 'gift_times' ? { priceUnit, giftSegments } : { segments }),
            } : {}),
          },
        ];
      },
    );
    return { items, nextCursor };
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

  private employeeScope(
    clubId: string,
    userId: string,
  ): QueryFilter<ClubOrder> {
    return {
      clubId,
      $or: [
        { dispatcherUserId: userId },
        { dispatchStatus: 'published', 'shares.userId': userId },
        { dispatchStatus: 'published', 'giftDispatch.segments.shares.userId': userId },
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
    if (input.requestedHearts !== undefined || input.requestedGiftTimes === undefined) {
      throw new BadRequestException('新订单须按赠送次数提交');
    }
    const { requestedGiftTimes, deliveryPeriodPreference, doubleGiftTimes } = input;
    if (doubleGiftTimes !== undefined &&
        (deliveryPeriodPreference !== 'split' || doubleGiftTimes >= requestedGiftTimes)) {
      throw new BadRequestException('分段时的双倍期赠送次数须少于总次数');
    }
    const estimatedReceivedHearts = input.estimatedReceivedHearts ??
      estimateReceivedHearts(requestedGiftTimes, deliveryPeriodPreference, doubleGiftTimes);
    if (estimatedReceivedHearts === undefined && (deliveryPeriodPreference === 'double' || doubleGiftTimes !== undefined)) {
      throw new BadRequestException('预计实收爱心颗数超出可记录范围');
    }

    if (submission.source === 'direct_dispatch' && submission.input.existingCustomerUserId) {
      await this.customers.requireExisting(submission.input.existingCustomerUserId);
    }

    let dispatcherUserId: string | undefined = userId;
    if (submission.source === 'client_order') {
      try {
        dispatcherUserId = await this.resolveDispatcher(clubId, submission.input.dispatcherUserId);
      } catch (error) {
        if (error instanceof BadRequestException) {
          // A concurrent request can save the original assignment while eligibility changes.
          const saved = await this.orders.findOne(key).lean();
          if (saved) return this.checkReplay(saved, submission);
        }
        throw error;
      }
    }

    const ownership =
      submission.source === 'direct_dispatch'
        ? {
            dispatcherAssignment: 'creator',
            dispatchStatus: 'draft',
            customerLinkStatus: submission.input.existingCustomerUserId ? 'verified' : 'pending_verification',
            customerLabel: submission.input.customerLabel,
            customerUserId: submission.input.existingCustomerUserId,
            selectedCustomerUserId: submission.input.existingCustomerUserId,
            newCustomerNickname: submission.input.newCustomerNickname,
          }
        : {
            requestedDispatcherUserId: submission.input.dispatcherUserId,
            ...(dispatcherUserId ? {
              dispatcherAssignment: submission.input.dispatcherUserId ? 'customer_selected' : 'random',
              dispatchStatus: 'pending',
            } : { dispatchStatus: 'pending_assignment' }),
            customerUserId: userId,
            customerLinkStatus: 'verified',
          };

    try {
      return await this.orders.create({
        ...key,
        ...ownership,
        dispatcherUserId,
        businessType: 'heart_delivery',
        recipientGameAccount: input.recipientGameAccount,
        heartDelivery: {
          requestedGiftTimes,
          estimatedReceivedHearts,
          ...(input.estimatedReceivedHearts === undefined && estimatedReceivedHearts !== undefined
            ? { estimatedReceivedHeartsDerived: true }
            : {}),
          deliveryPeriodPreference,
          doubleGiftTimes,
        },
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
      return undefined;
    }
    return candidates[requestedUserId ? 0 : randomInt(candidates.length)];
  }

  private checkReplay(order: ClubOrder, submission: Submission) {
    const { input } = submission;
    const { heartDelivery } = order;
    const originalEstimate = heartDelivery.estimatedReceivedHeartsDerived ? undefined : heartDelivery.estimatedReceivedHearts;
    const matchesSourceFields =
      submission.source === 'direct_dispatch'
        ? order.customerLabel === submission.input.customerLabel &&
          order.selectedCustomerUserId === submission.input.existingCustomerUserId &&
          order.newCustomerNickname === submission.input.newCustomerNickname
        : (order.requestedDispatcherUserId ??
            (order.dispatcherAssignment === 'customer_selected' ? order.dispatcherUserId : undefined)) ===
          submission.input.dispatcherUserId;
    if (
      !matchesSourceFields ||
      order.recipientGameAccount !== input.recipientGameAccount ||
      heartDelivery.requestedHearts !== input.requestedHearts ||
      heartDelivery.requestedGiftTimes !== input.requestedGiftTimes ||
      heartDelivery.deliveryPeriodPreference !== input.deliveryPeriodPreference ||
      heartDelivery.doubleGiftTimes !== input.doubleGiftTimes ||
      originalEstimate !== input.estimatedReceivedHearts
    ) {
      throw new ConflictException('相同提交标识已用于创建内容不同的订单');
    }
    return order;
  }
}
