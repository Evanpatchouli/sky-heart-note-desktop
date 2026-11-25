import type { PersonalScheduleDto } from './club-personal-schedule.dto';
import { giftDayFacts, giftFactsByShare, giftFactsForOrders } from './club-gift-delivery';
import { giftAssignment, giftAssignmentDetail, personalAssignmentScope, personalScheduleView } from './club-personal-assignment';
import { CLUB_ID } from './club.schema';
import { ClubGiftSupervision, canContinueGiftOrder, giftExceptionScope } from './club-gift-supervision';
import { continuationView } from './club-continuation.service';
import { jsonReportCount } from './club-daily-report-view';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { calculateGiftQuote, calculateQuoteAmounts, estimateReceivedHearts, giftFulfillmentSegments, type CommissionRule, type CustomerGiftProgress, type CustomerQuote, type OrderPricing } from '@webapp-template/common';
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
  PublishOrderDto,
  RecordOrderReceiptDto,
  ReviewDispatchCommissionDto,
  UpdateOrderPricingDto,
} from './club-pricing.dto';
import type { StoredOrderReceipt } from './club-pricing.schema';
import { ClubOrder, type PendingAssignmentDecision } from './club-order.schema';
import { ClubPromotionService } from './club-promotion.service';
import { ClubDispatchPushService } from './club-dispatch-push.service';

const clientOrderScope = {
  source: 'client_order',
  customerLinkStatus: 'verified',
} as const;

const incompleteCustomerLink = {
  newCustomerNickname: { $exists: true },
  customerLinkStatus: 'pending_verification',
};
const PRE_DISPATCH_STATUSES = ['draft', 'pending'];

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
    const { discountedHeartsAmountCents } = pricing;
    const amounts = calculateQuoteAmounts(segments, discountedHeartsAmountCents);
    return amounts && { revision, segments, ...amounts };
  }
  const amounts = giftSegments && calculateGiftQuote(giftSegments);
  if (!amounts) return null;
  const { promotions, discountedHeartsAmountCents } = pricing;
  const heartsAmountCents = promotions
    ? amounts.amountCents - (promotions.platform?.amountCents ?? 0) - (promotions.personal?.amountCents ?? 0)
    : discountedHeartsAmountCents ?? amounts.amountCents;
  const totalAmountCents = heartsAmountCents;
  if (!Number.isSafeInteger(totalAmountCents) || (!promotions && discountedHeartsAmountCents !== undefined &&
      (!Number.isSafeInteger(discountedHeartsAmountCents) || heartsAmountCents < 0 || heartsAmountCents >= amounts.amountCents))) return null;
  return {
    revision, priceUnit, giftSegments, segments,
    ...(promotions ? { promotions } : {}),
    ...(promotions || discountedHeartsAmountCents !== undefined ? { originalHeartsAmountCents: amounts.amountCents } : {}),
    heartsAmountCents, totalAmountCents,
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
    ...continuationView(order),
    canManageContinuation: canContinueGiftOrder(order),
    dispatchStatus: order.dispatchStatus,
    quote,
    ...(order.requestedPromotionCouponId ? { requestedPromotionCouponId: order.requestedPromotionCouponId } : {}),
    receipt: order.receipt ?? null,
    commissionReview: order.commissionReview ?? null,
    paymentStatus: paymentStatus(order.receipt),
    giftDeliveryStopped: !!order.giftTermination,
  };
}

type HistoricalProgress = {
  priceUnit: 'received_hearts';
  agreedDeadline: string | null;
  observedHearts: number | string;
  creditedHearts: number;
  remainingHearts: number;
};

function customerOrderView(order: ClubOrder, names: Map<string, string>, deliveryProgress: CustomerGiftProgress | HistoricalProgress) {
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
    ...continuationView(order),
    deliveryProgress,
    closedAt: order.closedAt ?? null,
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
    private readonly giftSupervision: ClubGiftSupervision,
    private readonly promotions: ClubPromotionService,
    private readonly dispatchPush: ClubDispatchPushService,
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
          ...(kind === 'assigned' ? {
            dispatcherUserId, dispatcherAssignment: 'manual', intakeNoticePendingAt: decision.decidedAt,
          } : {}),
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

  async listCustomerOrders(clubId: string, userId: string, query: ClubOrderQuery) {
    await this.directory.requireClub(clubId);
    const { orders, nextCursor } = await this.list(
      { clubId, customerUserId: userId, customerLinkStatus: 'verified' },
      query,
    );
    const [names, progress] = await Promise.all([
      this.directory.memberNicknames([
        ...new Set(orders.flatMap(({ dispatcherUserId }) => dispatcherUserId ? [dispatcherUserId] : [])),
      ]),
      Promise.all(orders.map(order => this.customerProgress(order))),
    ]);
    return { items: orders.map((order, index) => customerOrderView(order, names, progress[index])), nextCursor };
  }

  async getCustomerOrder(clubId: string, userId: string, orderId: string) {
    await this.directory.requireClub(clubId);
    const order = await this.get(orderId, {
      clubId,
      customerUserId: userId,
      customerLinkStatus: 'verified',
    });
    const [names, progress] = await Promise.all([
      this.directory.memberNicknames(order.dispatcherUserId ? [order.dispatcherUserId] : []),
      this.customerProgress(order),
    ]);
    return customerOrderView(order, names, progress);
  }

  private async customerProgress(order: ClubOrder) {
    return await this.giftSupervision.customer(order) ?? (await this.historicalProgress(order)).progress;
  }

  private async historicalProgress(order: ClubOrder, through?: string) {
    const quote = order.receipt?.quote ?? order.dispatchPricing ?? order.pricing;
    const agreed = quote?.segments.length
      ? quote.segments.reduce((sum, segment) => sum + segment.hearts + (segment.giftHearts ?? 0), 0)
      : order.heartDelivery.requestedHearts ?? 0;
    const facts = order.shares.length ? await this.orders.db.collection('club_daily_reports').aggregate<{
      _id: Types.ObjectId; hearts: Types.Decimal128;
    }>([
      { $match: { orderId: order._id, shareId: { $in: order.shares.map(share => share._id) }, priceUnit: null,
        kind: 'daily', ...(through ? { businessDate: { $lte: through } } : {}) } },
      { $group: { _id: '$shareId', hearts: { $sum: { $toDecimal: { $toLong: '$receivedHearts' } } } } },
    ]).toArray() : [];
    const byShare = new Map(facts.map(row => [row._id.toHexString(), BigInt(row.hearts.toString())]));
    let observed = 0n;
    let credited = 0;
    const shares = order.shares.map(share => {
      const actual = byShare.get(share._id.toHexString()) ?? 0n;
      observed += actual;
      const delivered = actual > BigInt(share.hearts) ? share.hearts : Number(actual);
      credited += delivered;
      return { id: share._id.toHexString(), userId: share.userId, promisedHearts: share.hearts,
        observedHearts: jsonReportCount(actual), remainingHearts: share.hearts - delivered };
    });
    credited = Math.min(agreed, credited);
    const progress: HistoricalProgress = {
      priceUnit: 'received_hearts', agreedDeadline: order.heartDelivery.agreedDeadline ?? null,
      observedHearts: jsonReportCount(observed),
      creditedHearts: credited, remainingHearts: agreed - credited };
    return { progress, shares };
  }

  async getDispatchFulfillment(clubId: string, userId: string, orderId: string, through?: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    if (order.heartDelivery.requestedGiftTimes !== undefined)
      return { ...await this.giftSupervision.dispatch(order, through), ...continuationView(order) };
    const [{ progress, shares }, names] = await Promise.all([
      this.historicalProgress(order, through),
      this.directory.memberNicknames([...new Set(order.shares.map(share => share.userId))]),
    ]);
    return {
      ...progress, closedAt: order.closedAt ?? null,
      shares: shares.map(share => ({ ...share, nickname: names.get(share.userId) ?? null })),
    };
  }

  async listFulfillmentExceptions(clubId: string, userId: string, query: ClubOrderQuery & { through: string }) {
    await this.directory.requireMember(clubId, userId);
    const { through, source, limit = 15 } = query;
    const scope = { clubId, dispatcherUserId: userId, ...giftExceptionScope(through) };
    const items: { order: ReturnType<typeof orderSummary>; fulfillment: NonNullable<Awaited<ReturnType<ClubGiftSupervision['exceptions']>>> }[] = [];
    let after = query.after;
    do {
      const { orders, nextCursor } = await this.list(scope, { source, after, limit: 25 });
      const exceptions = await Promise.all(orders.map(order => this.giftSupervision.exceptions(order, through)));
      for (const [index, fulfillment] of exceptions.entries()) {
        if (!fulfillment) continue;
        if (items.length === limit) return { items, nextCursor: items.at(-1)!.order.id };
        items.push({ order: orderSummary(orders[index]), fulfillment });
      }
      after = nextCursor ?? undefined;
    } while (after);
    return { items, nextCursor: null };
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
        : query.responsibility === 'executor'
          ? personalAssignmentScope(clubId, userId)
          : this.employeeScope(clubId, userId);
    const { orders, nextCursor } = await this.list(scope, query);
    if (query.responsibility === 'executor') {
      const giftFacts = giftFactsByShare(await giftFactsForOrders(this.orders.db.collection('club_daily_reports'), orders));
      return {
        items: await Promise.all(orders.map(order => order.dispatchPricing?.priceUnit === 'gift_times'
          ? giftAssignment(order, userId, giftFacts)
          : this.historicalAssignment(order, userId))),
        nextCursor,
      };
    }
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

  async getPersonalAssignment(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, personalAssignmentScope(clubId, userId));
    if (order.dispatchPricing?.priceUnit !== 'gift_times') return this.historicalAssignment(order, userId);
    const facts = await giftDayFacts(this.orders.db.collection('club_daily_reports'), order);
    return giftAssignmentDetail(order, userId, giftFactsByShare(facts));
  }

  private async historicalAssignment(order: ClubOrder, userId: string) {
    const { shares } = await this.historicalProgress(order);
    const ownShares = shares.filter(share => share.userId === userId);
    const own = order.shares.filter(share => share.userId === userId);
    const observed = ownShares.reduce((sum, share) => sum + BigInt(share.observedHearts), 0n);
    const remaining = ownShares.reduce((sum, share) => sum + share.remainingHearts, 0);
    const credited = ownShares.reduce((sum, share) => sum + share.promisedHearts - share.remainingHearts, 0);
    return {
      id: order._id.toHexString(),
      priceUnit: 'received_hearts' as const,
      recipientGameAccount: order.recipientGameAccount,
      personalSchedule: personalScheduleView(order, userId),
      shares: own.map(share => ({
        ...shareSummary(share),
        executionGameAccounts: (share.executionGameAccounts ?? []).map(account => ({
          id: account._id.toHexString(), name: account.name,
        })),
      })),
      delivery: { myObservedHearts: jsonReportCount(observed), myCreditedHearts: credited, myRemainingHearts: remaining,
        myExcessHearts: jsonReportCount(observed - BigInt(credited)) },
    };
  }

  async recordPersonalSchedule(clubId: string, userId: string, orderId: string, input: PersonalScheduleDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = personalAssignmentScope(clubId, userId);
    const order = await this.get(orderId, scope);
    const { startDate, endDate, expectedRevision } = input;
    if ((startDate === null) !== (endDate === null) || (startDate && endDate && (startDate.startsWith('0000') || endDate < startDate))) {
      throw new BadRequestException('请填写有效的本人排期起止日期，或同时清空');
    }
    const sameDates = (current: ReturnType<typeof personalScheduleView>) =>
      current.startDate === startDate && current.endDate === endDate;
    const current = personalScheduleView(order, userId);
    if (sameDates(current) && [expectedRevision, expectedRevision + 1].includes(current.revision)) return current;
    if (current.revision === expectedRevision) {
      const saved = { startDate, endDate, revision: expectedRevision + 1 };
      const entry = { userId, ...saved };
      const { matchedCount } = await this.orders.updateOne(
        {
          ...scope,
          _id: order._id,
          ...(expectedRevision === 0
            ? { 'personalSchedules.userId': { $ne: userId } }
            : { personalSchedules: { $elemMatch: { userId, revision: expectedRevision } } }),
        },
        expectedRevision === 0
          ? { $push: { personalSchedules: entry } }
          : { $set: { 'personalSchedules.$[mine]': entry } },
        {
          runValidators: true, timestamps: false,
          writeConcern: { w: 'majority', j: true },
          ...(expectedRevision ? { arrayFilters: [{ 'mine.userId': userId, 'mine.revision': expectedRevision }] } : {}),
        },
      );
      if (matchedCount) return saved;
      const latest = personalScheduleView(await this.get(orderId, scope), userId);
      if (latest.revision === expectedRevision + 1 && sameDates(latest)) return latest;
    }
    throw new ConflictException('本人排期已更新，请刷新后重新调整');
  }

  async getDispatchPreparation(
    clubId: string,
    userId: string,
    orderId: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    if (order.dispatchStatus === 'published') return dispatchPreparation(order, null);
    const [rule, promotionPolicy, promotionCoupons] = await Promise.all([
      this.directory.readCommissionRule(clubId),
      this.promotions.readPolicy(clubId),
      order.customerUserId && order.customerLinkStatus === 'verified' ? this.promotions.availableCoupons(clubId, order.customerUserId) : [],
    ]);
    return {
      ...dispatchPreparation(order, rule),
      promotionPolicy, promotionCoupons,
    };
  }

  getCustomerCoupons(clubId: string, userId: string) {
    return this.promotions.availableCoupons(clubId, userId);
  }

  async listClientOrderNotices(userId: string) {
    const club = await this.directory.getEmployeeClub(userId);
    if (!club) return [];
    const orders = await this.orders.find({
      clubId: CLUB_ID,
      dispatcherUserId: userId, source: 'client_order', dispatchStatus: 'pending', customerLinkStatus: 'verified',
    }).sort({ _id: -1 }).limit(20).select({ recipientGameAccount: 1, createdAt: 1 }).lean();
    return orders.map(order => ({
      orderId: order._id.toHexString(), clubName: club.name,
      recipientGameAccount: order.recipientGameAccount, createdAt: order.createdAt,
    }));
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
    const giftSegments = input.giftSegments.map(({ promotionalGiftTimes: _gift, ...segment }) => segment);
    const giftTimesBySegment = input.giftSegments.map(segment => segment.promotionalGiftTimes ?? 0);
    const amounts = calculateGiftQuote(giftSegments);
    const requested = order.heartDelivery.requestedGiftTimes;
    if (requested === undefined) {
      throw new ConflictException('历史订单按原订购颗数保留，无法写入按次报价');
    }
    if (!amounts || amounts.paidGiftTimes !== requested) {
      throw new BadRequestException('各报价段付费次数合计须等于原订购次数，请核对每日次数和金额');
    }

    const legacyDiscount = order.pricing?.discountedHeartsAmountCents;
    if (legacyDiscount !== undefined && (input.personalDiscountCents || giftTimesBySegment.some(Boolean) || input.platformCouponId))
      throw new ConflictException('历史折扣报价须沿用原有优惠口径');
    const personalCents = input.personalDiscountCents ?? order.pricing?.promotions?.personal?.amountCents ?? 0;
    const savedSelection = order.pricing?.promotions?.selectedCouponId;
    const selectedCouponId = input.platformCouponId !== undefined ? input.platformCouponId :
      savedSelection !== undefined ? savedSelection : order.requestedPromotionCouponId ?? null;
    const promotions = legacyDiscount === undefined ? await this.promotions.quote(order, giftSegments, amounts.amountCents, requested,
      personalCents, selectedCouponId, input.platformCouponId !== undefined, giftTimesBySegment) : undefined;
    const pricing = {
      basis: 'gift_times' as const,
      ruleVersion: rule.version,
      priceUnit: 'gift_times' as const,
      dispatchFeeCents: input.dispatchFeeCents,
      segments: [],
      ...(legacyDiscount !== undefined ? { discountedHeartsAmountCents: legacyDiscount } : {}),
      ...(promotions && (promotions.platform || promotions.personal || promotions.gift || promotions.couponIssue ||
        order.requestedPromotionCouponId || input.platformCouponId !== undefined) ? { promotions } : {}),
      giftSegments,
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
    return this.getDispatchPreparation(clubId, userId, orderId);
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
    const couponId = quote.promotions?.platform?.couponId;
    if (!input.receivedAmountCents && quote.totalAmountCents)
      throw new BadRequestException('请填写本单实际收款金额');
    const receipt: StoredOrderReceipt = {
      requestId: input.requestId,
      receivedAmountCents: input.receivedAmountCents,
      receivedByUserId: userId,
      recordedByUserId: userId,
      receivedAt,
      recordedAt: new Date(),
      quote,
    };
    try {
      const { matchedCount } = await this.orders.updateOne({
        ...scope, _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        'pricing.revision': quote.revision,
        receipt: { $exists: false },
      }, {
        $set: { receipt, ...(couponId ? { activePromotionCouponId: couponId } : {}) },
      }, { runValidators: true, writeConcern: { w: 'majority', j: true } });
      if (matchedCount) return { receipt, paymentStatus: paymentStatus(receipt) };
    } catch (error) {
      if (isDuplicateKey(error, 'activePromotionCouponId')) throw new ConflictException('此券已用于另一笔订单，请重新核对报价');
      throw error;
    }
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
    return this.getDispatchPreparation(clubId, userId, orderId);
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

    const { revision, priceUnit, giftSegments, segments, promotions,
      totalAmountCents, originalHeartsAmountCents, heartsAmountCents } = receipt.quote;
    const giftDispatch = input.giftDispatchSegments
      ? await this.giftDispatch.prepareInitial(clubId, input.giftDispatchSegments, giftFulfillmentSegments(giftSegments ?? [], promotions))
      : undefined;
    const dispatchPricing = {
      ...rule, revision, priceUnit, giftSegments, segments,
      ...(promotions ? { promotions } : {}),
      ...(!promotions && originalHeartsAmountCents !== undefined ? { discountedHeartsAmountCents: heartsAmountCents } : {}),
      dispatchFeeCents: commission.dispatchFeeCents,
    };
    const recipientUserIds = await this.directory.eligibleGiftMembers(clubId);
    if (!recipientUserIds.includes(userId)) {
      throw new ForbiddenException('需要本俱乐部有效成员身份');
    }
    const publishedAt = new Date();
    const publication = {
      id: new Types.ObjectId(),
      clubId,
      orderId: order._id,
      publishedAt,
      recipientUserIds,
      pending: true,
      nextAttemptAt: publishedAt,
      ...this.dispatchPush.publicationSchedule(publishedAt),
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
          dispatchStatus: 'published', publishedAt, dispatchPricing, publication,
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
    return {
      ...orderSummary(order),
      publicationId: order.publication?.id.toHexString(),
      dispatchPricing: order.dispatchPricing,
    };
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
        if (submission.input.platformCouponId)
          await this.promotions.requireAvailableCoupon(clubId, userId, submission.input.platformCouponId);
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
            requestedPromotionCouponId: submission.input.platformCouponId,
            ...(dispatcherUserId ? {
              dispatcherAssignment: submission.input.dispatcherUserId ? 'customer_selected' : 'random',
              dispatchStatus: 'pending',
              intakeNoticePendingAt: new Date(),
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
        : order.requestedPromotionCouponId === submission.input.platformCouponId &&
          (order.requestedDispatcherUserId ??
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
