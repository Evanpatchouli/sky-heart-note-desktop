import { giftDayFacts, giftFactsByShare, giftFactsForOrders } from './club-gift-delivery';
import { giftAssignment, giftAssignmentDetail, personalAssignmentScope, personalScheduleView } from './club-personal-assignment';
import { CLUB_ID } from './club.schema';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { calculateGiftQuote, calculateQuoteAmounts, estimateReceivedHearts, giftFulfillmentSegments } from '@sky-club/common';
import type {
  CommissionRule,
  CustomerQuote,
  CustomerGiftProgress,
  DeliveryPeriodShift,
  DispatchFulfillment,
  GiftDispatchSupervision,
  OrderPricing,
  PaymentStatus,
} from '@sky-club/common';
import { randomInt } from 'node:crypto';
import { Model, QueryFilter, Types, isObjectIdOrHexString } from 'mongoose';
import type { SessionUser } from '../../auth/app-access';
import { isDuplicateKey } from '../user-module/user-id';
import type { PublishOrderDto } from './club-allocation.dto';
import {
  dispatchAllocationView,
  makeAllocation,
  sortDirectedShares,
} from './club-allocation';
import { ClubCustomerService } from './club-customer.service';
import { UserDispatchActivationService } from '../user-module/user-dispatch-activation.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';
import { continuationView } from './club-continuation.service';
import { ClubGiftSupervision, canContinueGiftOrder, giftExceptionScope } from './club-gift-supervision';
import { giftDispatchFingerprint, giftShareView } from './club-gift-allocation';
import { ClubDispatchPushService } from './club-dispatch-push.service';
import { ClubDeliveryService } from './club-delivery.service';
import { compareDeliveryPrice, summarizeDeliveryPeriods, type DeliveryPeriodRow } from './club-delivery-review';
import { ClubPriceAdjustmentService } from './club-price-adjustment.service';
import { adjustmentDeliveryHold, priceAdjustmentHistoryView, priceAdjustmentReviewsView, priceAdjustmentView } from './club-price-adjustment';
import { deliveryStoppedAt, dispatchTerminationView, terminationView } from './club-termination';
import {
  customerFulfillmentView,
  deliveryProgressView,
  dispatchFulfillmentView,
  quotedDeliverySegments,
  type AgreedDayReport,
  type ShareDelivery,
} from './club-delivery';
import type {
  AgreedReportDatesDto,
  AgreementDeadlineDto,
  FulfillmentExceptionsQuery,
  PersonalScheduleDto,
} from './club-fulfillment.dto';
import {
  executionAccountView,
} from './club-execution.service';
import type {
  AssignDispatcherDto,
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
  EmployeeClubOrderQuery,
} from './club-order.dto';
import type {
  RecordOrderReceiptDto,
  ReviewDispatchCommissionDto,
  UpdateOrderPricingDto,
} from './club-pricing.dto';
import type { StoredOrderReceipt } from './club-pricing.schema';
import { ClubPromotionService } from './club-promotion.service';
import { activityQuantities, pendingQuoteActivity } from './club-order-pricing';
import { ClubOrder, type PendingAssignmentDecision } from './club-order.schema';

const clientOrderScope = {
  source: 'client_order',
  customerLinkStatus: 'verified',
} as const;

const PRE_DISPATCH_STATUSES = ['draft', 'pending'];
const incompleteCustomerLink = {
  newCustomerNickname: { $exists: true },
  customerLinkStatus: 'pending_verification',
};

type Submission =
  | { source: 'direct_dispatch'; input: CreateDirectOrderDto }
  | { source: 'client_order'; input: CreateClientOrderDto };

function orderSummary(order: ClubOrder) {
  const { deliveryPeriodPreference } = order.heartDelivery;
  const stoppedAt = deliveryStoppedAt(order);
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
    ...activityQuantities(order),
    deliveryPeriodPreference,
    dispatcherUserId: order.dispatcherUserId ?? null,
    dispatcherAssignment: order.dispatcherAssignment ?? null,
    dispatchStatus: order.dispatchStatus,
    publishedAt: order.publishedAt ?? null,
    createdAt: order.createdAt,
    ...(stoppedAt ? { stoppedAt } : {}),
  };
}

function calculateCustomerQuote(pricing?: OrderPricing): CustomerQuote | null {
  if (!pricing) return null;
  const { revision, segments, discountedHeartsAmountCents, promotions } = pricing;
  if (pricing.priceUnit === 'gift_times') {
    const { giftSegments } = pricing;
    const giftQuote = giftSegments && calculateGiftQuote(giftSegments);
    if (!giftQuote) return null;
    const original = giftQuote.amountCents;
    const heartsAmountCents = promotions ? original - (promotions.platform?.amountCents ?? 0) - (promotions.personal?.amountCents ?? 0) :
      discountedHeartsAmountCents ?? original;
    const totalAmountCents = heartsAmountCents;
    if (
      !Number.isSafeInteger(totalAmountCents) ||
      (discountedHeartsAmountCents !== undefined && heartsAmountCents >= original)
    ) return null;
    return {
      revision,
      priceUnit: pricing.priceUnit,
      giftSegments,
      segments,
      ...(promotions ? { promotions } : {}),
      heartsAmountCents,
      totalAmountCents,
      ...(discountedHeartsAmountCents === undefined && !promotions ? {} : { originalHeartsAmountCents: original }),
    };
  }
  const amounts = calculateQuoteAmounts(segments, discountedHeartsAmountCents);
  return amounts && { revision, segments, ...amounts };
}

function paymentStatus(receipt?: StoredOrderReceipt): PaymentStatus {
  if (!receipt) return 'not_registered';
  if (receipt.receivedAmountCents < receipt.quote.totalAmountCents)
    return 'underpaid';
  if (receipt.receivedAmountCents > receipt.quote.totalAmountCents)
    return 'overpaid';
  return 'paid_in_full';
}

function customerOrderView(
  order: ClubOrder,
  dispatcherNickname: string | null,
  totals: readonly ShareDelivery[],
  giftProgress?: CustomerGiftProgress,
  lateReports = false,
) {
  const { receipt } = order;
  const pricing = order.pricing ?? order.dispatchPricing;
  const quote = receipt?.quote ?? calculateCustomerQuote(pricing);
  const pendingActivity = pendingQuoteActivity(pricing);
  return {
    ...orderSummary(order),
    dispatcherNickname,
    deliveryProgress: giftProgress ?? customerFulfillmentView(order, totals),
    closedAt: order.closedAt ?? null,
    quote,
    ...continuationView(order),
    ...(pendingActivity ? { pendingActivity } : {}),
    ...(!quote && pricing && pricing.priceUnit !== 'gift_times'
      ? {
          quoteSegments: pricing.segments.map(({ period, hearts, giftHearts, unitPriceCents }) => ({
            period,
            hearts,
            unitPriceCents,
            ...(giftHearts ? { giftHearts } : {}),
          })),
        }
      : {}),
    receipt: receipt
      ? {
          receivedAmountCents: receipt.receivedAmountCents,
          receivedAt: receipt.receivedAt,
        }
      : null,
    paymentStatus: paymentStatus(receipt),
    priceAdjustment: priceAdjustmentView(order),
    priceAdjustmentHistory: priceAdjustmentHistoryView(order),
    termination: terminationView(order, lateReports),
  };
}

function byDeliveryOrder<T extends ShareDelivery | AgreedDayReport>(
  records: readonly T[],
) {
  const groups = new Map<string, T[]>();
  for (const item of records) {
    const id = item._id.orderId.toHexString();
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

function dispatchPreparation(
  order: ClubOrder,
  rule: CommissionRule | null,
  names?: Map<string, string>,
) {
  const pendingActivity = pendingQuoteActivity(order.pricing);
  return {
    pricing: order.pricing ?? null,
    rule,
    dispatchPricing: order.dispatchPricing ?? null,
    ...continuationView(order),
    canManageContinuation: canContinueGiftOrder(order),
    dispatchStatus: order.dispatchStatus,
    quote:
      order.receipt?.quote ??
      calculateCustomerQuote(order.pricing ?? order.dispatchPricing),
    receipt: order.receipt ?? null,
    ...(order.requestedPromotionCouponId ? { requestedPromotionCouponId: order.requestedPromotionCouponId } : {}),
    paymentStatus: paymentStatus(order.receipt),
    ...(pendingActivity ? { pendingActivity } : {}),
    giftDeliveryStopped: !!order.giftTermination,
    commissionReview: order.commissionReview ?? null,
    ...(order.allocation
      ? { allocation: dispatchAllocationView(order, names) }
      : {}),
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
    ...(order.allocation ? { allocation: dispatchAllocationView(order) } : {}),
  };
}

function employeeView(
  order: ClubOrder,
  userId: string,
  totals: readonly ShareDelivery[] = [],
  review?: ReturnType<typeof summarizeDeliveryPeriods>,
  pendingPersonalReports?: number,
) {
  const assignment = pendingPersonalReports !== undefined;
  const dispatches = !assignment && order.dispatcherUserId === userId;
  const mine = order.shares.filter((share) => share.userId === userId);
  return {
    ...orderSummary(order),
    ...(dispatches ? orderOwnership(order) : {}),
    ...(assignment ? { personalSchedule: personalScheduleView(order, userId) } : {}),
    ...(mine.length
      ? {
          delivery: {
            ...deliveryProgressView(order, userId, totals),
            holdReason: adjustmentDeliveryHold(order),
            ...(assignment ? {
              myPendingReports: pendingPersonalReports,
              myReportSyncPending: order.pendingDailyReport?.userId === userId,
            } : {}),
            ...(review
              ? {
                  quoteSegments: quotedDeliverySegments(order),
                  segmentsOverPlan: review.segmentsOverPlan,
                  periodBreakdown: review.breakdown,
                }
              : {}),
          },
        }
      : {}),
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
              claimKind: share.claimKind,
              claimedAt: share.claimedAt,
              executionGameAccounts: (share.executionGameAccounts ?? []).map(
                executionAccountView,
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
    private readonly delivery: ClubDeliveryService,
    private readonly adjustments: ClubPriceAdjustmentService,
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
    const order = await this.create(clubId, userId, {
      source: 'client_order',
      input,
    });
    const names = await this.directory.memberNicknames(
      order.dispatcherUserId ? [order.dispatcherUserId] : [],
    );
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
      {
        clubId,
        customerUserId: userId,
        customerLinkStatus: 'verified',
      },
      query,
    );
    const [names, totals, giftProgress] = await Promise.all([
      this.directory.memberNicknames([
        ...new Set(orders.flatMap(({ dispatcherUserId }) => dispatcherUserId ? [dispatcherUserId] : [])),
      ]),
      this.delivery.totals(orders.filter(order => order.heartDelivery.requestedGiftTimes === undefined).map(order => order._id)),
      Promise.all(orders.map(order => this.giftSupervision.customer(order))),
    ]);
    const byOrder = byDeliveryOrder(totals);
    return {
      items: orders.map((order, index) =>
        customerOrderView(
          order,
          order.dispatcherUserId ? names.get(order.dispatcherUserId) ?? null : null,
          byOrder.get(order._id.toHexString()) ?? [],
          giftProgress[index],
        ),
      ),
      nextCursor,
    };
  }

  async getCustomerOrder(clubId: string, userId: string, orderId: string) {
    await this.directory.requireClub(clubId);
    const order = await this.get(orderId, {
      clubId,
      customerUserId: userId,
      customerLinkStatus: 'verified',
    });
    const [names, totals, rows, giftProgress] = await Promise.all([
      this.directory.memberNicknames(order.dispatcherUserId ? [order.dispatcherUserId] : []),
      this.delivery.totals(order.heartDelivery.requestedGiftTimes === undefined ? [order._id] : []),
      deliveryStoppedAt(order) ? this.delivery.periodRows(order, undefined, true) : Promise.resolve<DeliveryPeriodRow[]>([]),
      this.giftSupervision.customer(order),
    ]);
    return customerOrderView(
      order,
      order.dispatcherUserId ? names.get(order.dispatcherUserId) ?? null : null,
      totals,
      giftProgress,
      rows.some((row) => row._id === null),
    );
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
    const claimedOrderIds = orders
      .filter((order) => order.shares.some((share) => share.userId === userId))
      .map((order) => order._id);
    const personal = query.responsibility === 'executor';
    const [totals, pendingReports, activationOrders, giftFacts] = await Promise.all([
      this.delivery.totals(claimedOrderIds),
      personal ? this.delivery.pendingPersonalReports(orders, userId) : undefined,
      personal ? undefined : this.customerActivationOrders(orders, userId),
      personal ? giftFactsForOrders(this.orders.db.collection('club_daily_reports'), orders) : [],
    ]);
    const totalsByOrder = byDeliveryOrder(totals);
    const giftFactsById = giftFactsByShare(giftFacts);
    return {
      items: orders.map((order) => {
        if (personal && order.dispatchPricing?.priceUnit === 'gift_times') return giftAssignment(order, userId, giftFactsById);
        const orderId = order._id.toHexString();
        return {
          ...employeeView(order, userId, totalsByOrder.get(orderId), undefined,
            pendingReports ? pendingReports.get(orderId) ?? 0 : undefined),
          ...(activationOrders?.has(orderId) ? { customerActivationAvailable: true } : {}),
        };
      }),
      nextCursor,
    };
  }

  async getEmployeeOrder(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const scope = this.employeeScope(clubId, userId);
    const order = await this.get(orderId, scope);
    if (!order.shares.some((share) => share.userId === userId))
      return employeeView(order, userId);
    const review = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order), userId);
    return employeeView(order, userId, review.totals, review);
  }

  async getPersonalAssignment(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, personalAssignmentScope(clubId, userId));
    if (order.dispatchPricing?.priceUnit === 'gift_times') {
      const facts = await giftDayFacts(this.orders.db.collection('club_daily_reports'), order);
      return giftAssignmentDetail(order, userId, giftFactsByShare(facts));
    }
    const [rows, pending] = await Promise.all([
      this.delivery.confirmedPeriodRows(order), this.delivery.pendingPersonalReports([order], userId),
    ]);
    const review = summarizeDeliveryPeriods(order, rows, userId);
    return employeeView(order, userId, review.totals, review, pending.get(order._id.toHexString()) ?? 0);
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

  async getDispatchFulfillment(
    clubId: string,
    userId: string,
    orderId: string,
    through?: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    if (order.heartDelivery.requestedGiftTimes !== undefined)
      return { ...await this.giftSupervision.dispatch(order, through), ...continuationView(order) };
    const [rows, reports, names] = await Promise.all([
      this.delivery.periodRows(order, through, true),
      this.delivery.agreedDayReports([order], through),
      this.directory.memberNicknames([...new Set(order.shares.map(({ userId }) => userId))]),
    ]);
    const review = summarizeDeliveryPeriods(order, rows);
    const progress = dispatchFulfillmentView(order, review.totals, reports, names, through);
    return {
      ...progress,
      ...(order.dispatchStatus === 'published' ? {
        deliveryReview: {
          ...review.breakdown,
          comparison: this.adjustments.withManualReview(order, compareDeliveryPrice(order, progress, review, { through })),
        },
        priceAdjustment: priceAdjustmentView(order),
        priceAdjustmentHistory: priceAdjustmentHistoryView(order),
        priceAdjustmentReviews: priceAdjustmentReviewsView(order),
        termination: dispatchTerminationView(order, review.issues.has('pending_reports')),
      } : {}),
    };
  }

  async getDispatchPeriodReports(clubId: string, userId: string, orderId: string, through?: string, after?: string) {
    const order = await this.requirePublishedDispatch(clubId, userId, orderId);
    return this.delivery.dispatchPeriodReports(order, through, after);
  }

  async previewDeliveryPrice(clubId: string, userId: string, orderId: string, shift: DeliveryPeriodShift) {
    const order = await this.requirePublishedDispatch(clubId, userId, orderId);
    return this.adjustments.preview(order, shift);
  }

  private async requirePublishedDispatch(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    return this.get(orderId, {
      clubId, dispatcherUserId: userId, dispatchStatus: 'published',
      'heartDelivery.requestedGiftTimes': { $exists: false },
    });
  }

  async listFulfillmentExceptions(
    clubId: string,
    userId: string,
    query: FulfillmentExceptionsQuery,
  ) {
    await this.directory.requireMember(clubId, userId);
    const { through, source } = query;
    const limit = query.limit ?? 15;
    const scope: QueryFilter<ClubOrder> = {
      clubId,
      dispatcherUserId: userId,
      $or: [
        giftExceptionScope(through),
        { 'heartDelivery.agreedDeadline': { $lte: through } },
        { 'shares.agreedReportDates': { $lte: through } },
      ],
    };
    const items: {
      order: ReturnType<typeof orderSummary>;
      fulfillment: DispatchFulfillment | GiftDispatchSupervision;
    }[] = [];
    let after = query.after;
    do {
      const { orders, nextCursor } = await this.list(scope, { after, source, limit: 25 });
      const historical = orders.filter(order => order.heartDelivery.requestedGiftTimes === undefined);
      const [views, giftViews] = await Promise.all([
        this.dispatchProgress(historical, through),
        Promise.all(orders.map(order => order.heartDelivery.requestedGiftTimes === undefined
          ? null : this.giftSupervision.exceptions(order, through))),
      ]);
      const byId = new Map(historical.map((order, index) => [order._id.toHexString(), views[index]]));
      for (const [index, order] of orders.entries()) {
        if (order.heartDelivery.requestedGiftTimes !== undefined) {
          const giftView = giftViews[index];
          if (!giftView) continue;
          if (items.length === limit) return { items, nextCursor: items.at(-1)!.order.id };
          items.push({ order: orderSummary(order), fulfillment: giftView });
          continue;
        }
        const view = byId.get(order._id.toHexString())!;
        const shares = view.shares.flatMap((share) => {
          const days = share.days.filter(
            (day) => day.status === 'missing' || day.supplementPending || day.correctionPending,
          );
          return share.overdue || days.length ? [{ ...share, days }] : [];
        });
        if (!view.overdue && !shares.length) continue;
        if (items.length === limit) return { items, nextCursor: items.at(-1)!.order.id };
        items.push({
          order: orderSummary(orders[index]),
          fulfillment: { ...view, shares },
        });
      }
      after = nextCursor ?? undefined;
    } while (after);
    return { items, nextCursor: null };
  }

  private async dispatchProgress(orders: readonly ClubOrder[], through?: string) {
    const memberIds = new Set(
      orders.flatMap(({ shares }) => shares.map(({ userId }) => userId)),
    );
    const [totals, reports, names] = await Promise.all([
      this.delivery.totals(orders.map(({ _id }) => _id), through),
      this.delivery.agreedDayReports(orders, through),
      this.directory.memberNicknames([...memberIds]),
    ]);
    const totalsByOrder = byDeliveryOrder(totals);
    const reportsByOrder = byDeliveryOrder(reports);
    return orders.map((order) => {
      const id = order._id.toHexString();
      return dispatchFulfillmentView(
        order,
        totalsByOrder.get(id) ?? [],
        reportsByOrder.get(id) ?? [],
        names,
        through,
      );
    });
  }

  async recordAgreementDeadline(
    clubId: string,
    userId: string,
    orderId: string,
    input: AgreementDeadlineDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (order.heartDelivery.requestedGiftTimes !== undefined)
      throw new ConflictException('按次订单的履约约定功能待启用');
    const { businessDate } = input;
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope, _id: order._id, termination: null, 'priceAdjustment.decision.value': { $ne: 'decline' },
        'heartDelivery.agreedDeadline': { $exists: false },
      },
      { $set: { 'heartDelivery.agreedDeadline': businessDate } },
      { runValidators: true },
    );
    if (
      !matchedCount &&
      (await this.get(orderId, scope)).heartDelivery.agreedDeadline !== businessDate
    ) {
      throw new ConflictException('本单已有客户约定截止业务日，原记录已保留');
    }
    return { agreedDeadline: businessDate };
  }

  async recordShareReportDates(
    clubId: string,
    userId: string,
    orderId: string,
    shareId: string,
    input: AgreedReportDatesDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    if (!isObjectIdOrHexString(shareId)) throw new BadRequestException('份额标识格式无效');
    const scope = { clubId, dispatcherUserId: userId, dispatchStatus: 'published' };
    const order = await this.get(orderId, scope);
    const share = order.shares.find(({ _id }) => _id.equals(shareId));
    if (!share) throw new NotFoundException('本单没有该份额');
    const dates = [...input.businessDates].sort();
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope,
        _id: order._id,
        termination: null,
        'priceAdjustment.decision.value': { $ne: 'decline' },
        shares: { $elemMatch: { _id: share._id, agreedReportDates: { $exists: false } } },
      },
      { $set: { 'shares.$.agreedReportDates': dates } },
      { runValidators: true },
    );
    if (!matchedCount) {
      const latest = (await this.get(orderId, scope)).shares.find(({ _id }) => _id.equals(shareId));
      if (JSON.stringify(latest?.agreedReportDates) !== JSON.stringify(dates)) {
        throw new ConflictException('该份额已有约定日报日期，原记录已保留');
      }
    }
    return { agreedReportDates: dates };
  }

  async getDispatchPreparation(
    clubId: string,
    userId: string,
    orderId: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(orderId, { clubId, dispatcherUserId: userId });
    if (order.dispatchStatus !== 'published') {
      const [rule, promotionPolicy, promotionCoupons] = await Promise.all([
        this.directory.readCommissionRule(clubId), this.promotions.readPolicy(clubId),
        order.customerUserId && order.customerLinkStatus === 'verified' ? this.promotions.availableCoupons(clubId, order.customerUserId) : [],
      ]);
      return { ...dispatchPreparation(order, rule), promotionPolicy, promotionCoupons };
    }
    const allocationMembers = new Set([
      ...(order.allocation?.directed ?? []).map((share) => share.userId),
      ...(order.allocation ? order.shares.map((share) => share.userId) : []),
    ]);
    const names = allocationMembers.size
      ? await this.directory.memberNicknames([...allocationMembers])
      : undefined;
    return dispatchPreparation(order, null, names);
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
      giftSegments,
      ...(legacyDiscount !== undefined ? { discountedHeartsAmountCents: legacyDiscount } : {}),
      ...(promotions && (promotions.platform || promotions.personal || promotions.gift || promotions.couponIssue ||
        order.requestedPromotionCouponId || input.platformCouponId !== undefined) ? { promotions } : {}),
      revision: input.expectedRevision + 1,
    };
    if (!calculateCustomerQuote(pricing)) {
      throw new BadRequestException('请核对报价金额范围，折后爱心款须低于折前');
    }
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
      throw new ConflictException('订单报价、收款或派发状态已更新，请重新加载');
    return this.getDispatchPreparation(clubId, userId, orderId);
  }

  async recordOrderReceipt(
    clubId: string,
    userId: string,
    orderId: string,
    input: RecordOrderReceiptDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    const receivedAt = new Date(input.receivedAt);
    if (!Number.isFinite(receivedAt.getTime()))
      throw new BadRequestException('实收时间格式无效');
    if (order.receipt)
      return this.replayOrderReceipt(order.receipt, input, receivedAt);
    if (pendingQuoteActivity(order.pricing)) {
      throw new ConflictException('买赠与折扣叠加规则待核对，目前无法登记实收');
    }

    const quote = calculateCustomerQuote(order.pricing);
    if (
      !quote ||
      quote.revision !== input.pricingRevision ||
      order.dispatchStatus === 'published'
    ) {
      throw new ConflictException('请重新加载并核对最新报价后登记实收');
    }
    if (!input.receivedAmountCents && quote.totalAmountCents)
      throw new BadRequestException('请填写本单实际收款金额');
    const couponId = quote.promotions?.platform?.couponId;
    const receipt: StoredOrderReceipt = {
      requestId: input.requestId,
      receivedByUserId: userId,
      recordedByUserId: userId,
      receivedAt,
      recordedAt: new Date(),
      receivedAmountCents: input.receivedAmountCents,
      quote,
    };
    try {
      const { matchedCount } = await this.orders.updateOne({
        ...scope,
        _id: order._id,
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
    if (latest.receipt)
      return this.replayOrderReceipt(latest.receipt, input, receivedAt);
    throw new ConflictException('报价或派发状态已更新，请重新加载后核对实收');
  }

  private replayOrderReceipt(
    receipt: StoredOrderReceipt,
    input: RecordOrderReceiptDto,
    receivedAt: Date,
  ) {
    if (receipt.requestId !== input.requestId) {
      throw new ConflictException('本单已有实收登记，请重新加载核对');
    }
    if (
      receipt.quote.revision !== input.pricingRevision ||
      receipt.receivedAmountCents !== input.receivedAmountCents ||
      receipt.receivedAt.getTime() !== receivedAt.getTime()
    ) {
      throw new ConflictException('相同提交标识已用于登记不同的收款信息');
    }
    return { receipt, paymentStatus: paymentStatus(receipt) };
  }

  async reviewDispatchCommission(
    clubId: string,
    userId: string,
    orderId: string,
    input: ReviewDispatchCommissionDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (
      order.dispatchStatus === 'published' ||
      order.giftTermination ||
      order.pricing?.priceUnit !== 'gift_times' ||
      order.receipt?.quote.revision !== input.pricingRevision
    ) {
      throw new ConflictException('请核对已登记实收的报价版本和派发状态');
    }
    const rule = await this.requireCurrentRule(clubId, input.ruleVersion);
    const commissionReview = {
      revision: input.expectedReviewRevision + 1,
      ruleVersion: rule.version,
      basis: rule.basis,
      dispatchFeeCents: input.dispatchFeeCents,
    };
    const { matchedCount } = await this.orders.updateOne(
      {
        ...scope,
        _id: order._id,
        dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
        giftTermination: null,
        'receipt.quote.revision': input.pricingRevision,
        'commissionReview.revision': input.expectedReviewRevision || {
          $exists: false,
        },
      },
      { $set: { commissionReview } },
      { runValidators: true },
    );
    if (!matchedCount)
      throw new ConflictException('派抽复核或派发状态已更新，请重新加载');
    return this.getDispatchPreparation(clubId, userId, orderId);
  }

  async commitDispatchAfterPayment(
    clubId: string,
    userId: string,
    orderId: string,
    input: PublishOrderDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.get(orderId, scope);
    if (order.dispatchStatus === 'published') {
      return this.replayDispatch(order, input);
    }
    if (order.giftTermination) throw new ConflictException('本单已停送，不能发布');
    if (pendingQuoteActivity(order.pricing)) {
      throw new ConflictException('买赠与折扣叠加规则待核对，目前无法派发');
    }
    const { pricingRevision, ruleVersion, commissionReviewRevision } = input;
    if (
      !order.pricing ||
      order.pricing.revision !== pricingRevision ||
      order.receipt?.quote.revision !== pricingRevision
    ) {
      throw new ConflictException('订单报价未准备或已更新，请重新确认');
    }
    if (paymentStatus(order.receipt) !== 'paid_in_full') {
      throw new ConflictException('实收与报价的差额待核对');
    }
    if ((order.commissionReview?.revision ?? 0) !== commissionReviewRevision) {
      throw new ConflictException('派抽复核已更新，请重新加载');
    }
    const giftOrder = order.pricing.priceUnit === 'gift_times';
    if (giftOrder && (input.publicHearts !== undefined || input.directed !== undefined)) {
      throw new BadRequestException('按次订单无法使用按颗分配方案');
    }
    const commission = order.commissionReview ?? order.pricing;
    if (giftOrder && (
      order.receipt.quote.priceUnit !== 'gift_times' ||
      commission.ruleVersion !== ruleVersion
    )) {
      throw new ConflictException('请重新核对最新的每次抽成规则');
    }
    if (!giftOrder && input.giftDispatchSegments !== undefined) {
      throw new BadRequestException('历史按颗订单无法配置按次分工');
    }
    const allocation = giftOrder ? undefined : makeAllocation(order, input);
    const { promotions } = order.receipt.quote;
    const giftDispatch = input.giftDispatchSegments
      ? await this.giftDispatch.prepareInitial(clubId, input.giftDispatchSegments, giftFulfillmentSegments(order.receipt.quote.giftSegments ?? [], promotions))
      : undefined;
    const recipientUserIds = (await this.directory.eligibleRecipients(clubId)).sort();
    const eligibleIds = new Set(recipientUserIds);
    if (!eligibleIds.has(userId)) {
      throw new ForbiddenException('需要本俱乐部有效成员身份');
    }
    if (allocation?.directed.some(({ userId }) => !eligibleIds.has(userId))) {
      throw new BadRequestException('指定对象须是本俱乐部可进入团员端的有效团员');
    }
    const rule = await this.requireCurrentRule(clubId, ruleVersion);
    if (commission.basis !== rule.basis) {
      throw new ConflictException(
        '共用计量口径已更新，请核对当前单位并重新保存派抽',
      );
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
    const { revision, segments, priceUnit, giftSegments, originalHeartsAmountCents, heartsAmountCents } = order.receipt.quote;
    const dispatchPricing = {
      ...rule,
      revision,
      segments,
      ...(priceUnit ? { priceUnit, giftSegments } : {}),
      ...(!promotions && originalHeartsAmountCents !== undefined ? { discountedHeartsAmountCents: heartsAmountCents } : {}),
      ...(promotions ? { promotions } : {}),
      dispatchFeeCents: commission.dispatchFeeCents,
    };
    const committed = await this.orders
      .findOneAndUpdate(
        {
          ...scope,
          _id: order._id,
          dispatchStatus: { $in: PRE_DISPATCH_STATUSES },
          giftTermination: null,
          'pricing.revision': pricingRevision,
          'receipt.quote.revision': pricingRevision,
          'receipt.receivedAmountCents': order.receipt.quote.totalAmountCents,
          'commissionReview.revision': commissionReviewRevision || {
            $exists: false,
          },
          dispatchPricing: { $exists: false },
          allocation: { $exists: false },
          'shares.0': { $exists: false },
        },
        {
          $set: {
            dispatchStatus: 'published',
            publishedAt,
            dispatchPricing,
            publication,
            ...(allocation ? { allocation } : { giftPublicationRequestId: input.requestId }),
            ...(giftDispatch ? { giftDispatch, giftPublicationScheduleFingerprint: giftDispatchFingerprint(input.giftDispatchSegments!) } : {}),
          },
          $unset: { pricing: '' },
        },
        {
          returnDocument: 'after',
          runValidators: true,
          writeConcern: { w: 'majority', j: true },
        },
      )
      .lean();
    if (committed) return this.dispatchReceipt(committed);

    const latest = await this.get(orderId, scope);
    if (latest.dispatchStatus === 'published') {
      return this.replayDispatch(latest, input);
    }
    throw new ConflictException('订单报价或派发状态已更新，请重新加载');
  }

  private dispatchReceipt(order: ClubOrder) {
    if (order.dispatchPricing?.priceUnit === 'gift_times') {
      return {
        ...orderSummary(order),
        publicationId: order.publication?.id.toHexString(),
        dispatchPricing: order.dispatchPricing,
      };
    }
    const { requestId, publicHearts, directed } = order.allocation!;
    return {
      ...orderSummary(order),
      ...(order.publication
        ? { publicationId: order.publication.id.toHexString() }
        : {}),
      dispatchPricing: order.dispatchPricing,
      allocation: { requestId, publicHearts, directed },
    };
  }

  private replayDispatch(order: ClubOrder, input: PublishOrderDto) {
    if (order.dispatchPricing?.priceUnit === 'gift_times') {
      if (
        order.giftPublicationRequestId !== input.requestId ||
        order.dispatchPricing.revision !== input.pricingRevision ||
        order.dispatchPricing.version !== input.ruleVersion ||
        (order.commissionReview?.revision ?? 0) !== input.commissionReviewRevision ||
        input.publicHearts !== undefined || input.directed !== undefined ||
        order.giftPublicationScheduleFingerprint !== (input.giftDispatchSegments && giftDispatchFingerprint(input.giftDispatchSegments))
      ) throw new ConflictException('订单已派发，提交标识或派发内容不同');
      return this.dispatchReceipt(order);
    }
    const saved = order.allocation;
    if (!saved || !order.dispatchPricing) {
      throw new ConflictException('历史订单已派发，未记录可用于接单的分配方案');
    }
    if (saved.requestId !== input.requestId || input.giftDispatchSegments !== undefined) {
      throw new ConflictException('订单已派发，请重新加载核对已发布的份额');
    }
    const directed = input.directed && sortDirectedShares(input.directed);
    if (
      order.dispatchPricing.revision !== input.pricingRevision ||
      order.dispatchPricing.version !== input.ruleVersion ||
      (order.commissionReview?.revision ?? 0) !==
        input.commissionReviewRevision ||
      saved.publicHearts !== input.publicHearts ||
      !directed ||
      saved.directed.length !== directed.length ||
      saved.directed.some(({ userId, hearts }, index) => {
        const share = directed[index];
        return userId !== share.userId || hearts !== share.hearts;
      })
    ) {
      throw new ConflictException('相同提交标识已用于内容不同的派发方案');
    }
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
        dispatcherUserId = await this.resolveDispatcher(
          clubId,
          submission.input.dispatcherUserId,
        );
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
    const chosenDispatcher = order.requestedDispatcherUserId ??
      (order.dispatcherAssignment === 'customer_selected'
        ? order.dispatcherUserId
        : undefined);
    const matchesSourceFields =
      submission.source === 'direct_dispatch'
        ? order.customerLabel === submission.input.customerLabel &&
          order.selectedCustomerUserId === submission.input.existingCustomerUserId &&
          order.newCustomerNickname === submission.input.newCustomerNickname
        : chosenDispatcher === submission.input.dispatcherUserId && order.requestedPromotionCouponId === submission.input.platformCouponId;
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
