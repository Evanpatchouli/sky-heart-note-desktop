import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { DeliveryPeriodShift, DeliveryPriceComparison } from '@webapp-template/common';
import { createHash } from 'node:crypto';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { customerFulfillmentView } from './club-delivery';
import { compareDeliveryPrice, summarizeDeliveryPeriods } from './club-delivery-review';
import { ClubDeliveryService } from './club-delivery.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubOrder } from './club-order.schema';
import { declineTermination } from './club-termination';
import { ClubTerminationService } from './club-termination.service';
import type {
  DecidePriceAdjustmentDto,
  ProposePriceAdjustmentDto,
  RecordPriceAdjustmentPaymentDto,
  RequestPriceReviewDto,
} from './club-price-adjustment.dto';
import {
  priceAdjustmentReviewView,
  priceAdjustmentView,
  type StoredPriceAdjustment,
  type StoredPriceAdjustmentReview,
} from './club-price-adjustment';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function shiftFields(shift: DeliveryPeriodShift) {
  const { quoteSegment, hearts, targetPeriod, targetUnitPriceCents } = shift;
  return { quoteSegment, hearts, targetPeriod, targetUnitPriceCents };
}

@Injectable()
export class ClubPriceAdjustmentService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly delivery: ClubDeliveryService,
    private readonly terminations: ClubTerminationService,
  ) {}

  async preview(order: ClubOrder, shift: DeliveryPeriodShift): Promise<DeliveryPriceComparison> {
    const review = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order, undefined, true));
    const progress = customerFulfillmentView(order, review.totals);
    return this.compareShift(order, shift, progress, review);
  }

  private compareShift(
    order: ClubOrder,
    shift: DeliveryPeriodShift,
    progress: ReturnType<typeof customerFulfillmentView>,
    review: ReturnType<typeof summarizeDeliveryPeriods>,
  ): DeliveryPriceComparison {
    const comparison = compareDeliveryPrice(order, progress, review, { shift });
    const unavailable = order.termination || (order.priceAdjustment && order.priceAdjustment.state !== 'continuing') ? 'adjustment_exists'
      : order.customerLinkStatus !== 'verified' || !order.customerUserId ? 'customer_not_linked'
      : order.dispatchWithdrawnAt ? 'dispatch_withdrawn'
      : !order.allocation ? 'allocation_unavailable'
      : !comparison.proposal || !comparison.original ? 'unverified_quote_or_delivery'
      : comparison.proposal.differenceCents <= 0 ? 'no_supplement_due'
      : null;
    const compared: DeliveryPriceComparison = {
      ...comparison,
      adjustmentReview: unavailable ? { unavailable } : {
        version: hash([
          order._id, order.customerUserId, order.fulfillmentRevision ?? 0, order.priceAdjustment?.id,
          comparison.original, comparison.proposal,
        ]),
      },
    };
    return unavailable ? this.withManualReview(order, compared, shift) : compared;
  }

  withManualReview(order: ClubOrder, comparison: DeliveryPriceComparison, shift?: DeliveryPeriodShift): DeliveryPriceComparison {
    const { original, proposal, issues } = comparison;
    if (!original || original.receivedCents !== original.totalCents || order.dispatchWithdrawnAt || order.termination ||
        (order.priceAdjustment && order.priceAdjustment.state !== 'continuing') ||
        issues.some((issue) => ['quote_unavailable', 'historical_view', 'shift_exceeds_remaining', 'shift_target_unchanged'].includes(issue)))
      return comparison;
    if (!proposal?.differenceCents && !issues.some((issue) => issue !== 'incomplete')) return comparison;
    return {
      ...comparison,
      manualReviewVersion: hash([
        order._id, order.customerLinkStatus, order.customerUserId,
        order.fulfillmentRevision ?? 0, order.priceAdjustment?.id,
        original, proposal, issues, shift ? shiftFields(shift) : null,
      ]),
    };
  }

  async requestReview(clubId: string, userId: string, orderId: string, input: RequestPriceReviewDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { requestId, reason, expectedVersion, shift } = input;
    const requestHash = hash(['review', userId, reason, expectedVersion, shift ? shiftFields(shift) : null]);
    const replay = (current: ClubOrder) => {
      const saved = current.priceAdjustmentReviews?.find((item) => item.requestId === requestId);
      if (!saved) return;
      if (saved.requestHash !== requestHash)
        throw new ConflictException('同一请求标识已用于不同的待核对记录');
      return priceAdjustmentReviewView(saved);
    };
    const saved = replay(order);
    if (saved) return saved;
    const review = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order, undefined, true));
    const progress = customerFulfillmentView(order, review.totals);
    const comparison = shift ? this.compareShift(order, shift, progress, review)
      : this.withManualReview(order, compareDeliveryPrice(order, progress, review));
    const { manualReviewVersion, original, proposal, issues } = comparison;
    if (!manualReviewVersion || expectedVersion !== manualReviewVersion || !original)
      throw new ConflictException('当前价差或实绩已变化，请刷新后核对');
    const record: StoredPriceAdjustmentReview = {
      id: new Types.ObjectId().toHexString(),
      original, proposal, issues, reason, requestId, requestHash,
      ...(shift ? { shift: shiftFields(shift) } : {}),
      fulfillmentRevision: order.fulfillmentRevision ?? 0,
      observedHearts: progress.observedHearts,
      remainingHearts: progress.remainingHearts,
      submittedAt: new Date().toISOString(),
      submittedByUserId: userId,
    };
    const updated = await this.orders.updateOne({
      ...scope,
      _id: order._id,
      dispatchStatus: 'published',
      dispatchWithdrawnAt: null,
      customerLinkStatus: order.customerLinkStatus,
      customerUserId: order.customerUserId ?? null,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      pendingDailyReport: null,
      'priceAdjustment.id': order.priceAdjustment?.id ?? null,
      termination: null,
      'priceAdjustmentReviews.requestId': { $ne: requestId },
    }, { $push: { priceAdjustmentReviews: record } }, durable);
    if (updated.modifiedCount) return priceAdjustmentReviewView(record);
    const latest = await this.find(scope, orderId);
    const concurrent = replay(latest);
    if (concurrent) return concurrent;
    throw new ConflictException('订单或实绩已变化，请刷新后核对');
  }

  async propose(clubId: string, userId: string, orderId: string, input: ProposePriceAdjustmentDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { requestId, reason, expectedVersion, quoteSegment, hearts, targetPeriod, targetUnitPriceCents } = input;
    const shift = { quoteSegment, hearts, targetPeriod, targetUnitPriceCents };
    const request = { id: requestId, hash: hash(['propose', userId, reason, expectedVersion, shift]) };
    const replay = this.replay(order, request);
    if (replay) return replay;
    const { adjustmentReview, original, proposal } = await this.preview(order, shift);
    if (!adjustmentReview || !('version' in adjustmentReview) || !original || !proposal)
      throw new ConflictException('当前报价、实绩或客户归属需要核对，无法提交正式改价');
    if (expectedVersion !== adjustmentReview.version)
      throw new ConflictException('订单已变化，请刷新后重新试算');

    const originalLine = proposal.lines[quoteSegment - 1];
    const observedCents = proposal.lines.reduce((total, line) => total + line.recordedHearts * line.unitPriceCents, 0);
    const previouslyReceivedCents = priceAdjustmentView(order)?.cumulativeReceivedCents ?? original.totalCents;
    const adjustment: StoredPriceAdjustment = {
      id: new Types.ObjectId().toHexString(),
      revision: 1,
      state: 'awaiting_customer',
      reason,
      shift,
      originalPeriod: originalLine.period,
      originalUnitPriceCents: originalLine.unitPriceCents,
      continuationSegment: proposal.lines.length,
      quoteRevision: original.quoteRevision,
      ruleVersion: original.ruleVersion,
      originalReceivedCents: original.receivedCents!,
      proposedTotalCents: proposal.totalCents,
      differenceCents: proposal.differenceCents,
      observedHearts: proposal.lines.reduce((total, line) => total + line.recordedHearts, 0),
      refundIfDeclinedCents: previouslyReceivedCents - observedCents,
      submittedByUserId: userId,
      submittedAt: new Date().toISOString(),
      customerUserId: order.customerUserId!,
      previouslyReceivedCents,
      basis: { fulfillmentRevision: order.fulfillmentRevision ?? 0, proposal },
      requests: [request],
    };
    const updated = await this.orders.findOneAndUpdate({
      ...scope,
      _id: order._id,
      dispatchStatus: 'published',
      dispatchWithdrawnAt: null,
      customerLinkStatus: 'verified',
      customerUserId: order.customerUserId,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      pendingDailyReport: null,
      termination: null,
      ...(order.priceAdjustment ? {
        'priceAdjustment.id': order.priceAdjustment.id,
        'priceAdjustment.state': 'continuing',
      } : { priceAdjustment: null }),
      'dispatchPricing.revision': original.quoteRevision,
      'dispatchPricing.version': original.ruleVersion,
    }, {
      $set: { priceAdjustment: adjustment },
      ...(order.priceAdjustment ? { $push: { priceAdjustmentHistory: order.priceAdjustment } } : {}),
    }, { ...durable, new: true }).lean();
    if (updated) return priceAdjustmentView(updated);
    return this.afterConflict(scope, orderId, request);
  }

  async decide(clubId: string, userId: string, orderId: string, input: DecidePriceAdjustmentDto) {
    const scope = { clubId, customerUserId: userId, customerLinkStatus: 'verified' };
    const order = await this.find(scope, orderId);
    const { adjustmentId, expectedRevision, decision, requestId } = input;
    const request = { id: requestId, hash: hash(['decide', userId, adjustmentId, expectedRevision, decision]) };
    const replay = this.replay(order, request);
    if (replay) return replay;
    const adjustment = order.priceAdjustment;
    if (!adjustment || adjustment.customerUserId !== userId)
      throw new NotFoundException('该改价方案不存在');
    return this.transition(scope, order, input, request, 'awaiting_customer', {
      state: decision === 'accept' ? 'awaiting_supplement' : 'refund_due',
      decision: { value: decision, userId, recordedAt: new Date().toISOString() },
    });
  }

  async recordPayment(clubId: string, userId: string, orderId: string, input: RecordPriceAdjustmentPaymentDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { requestId, adjustmentId, expectedRevision, kind, amountCents } = input;
    const occurredAt = new Date(input.occurredAt);
    const recordedAt = new Date();
    if (!Number.isFinite(occurredAt.getTime())) throw new BadRequestException('实收退款时间格式无效');
    const request = { id: requestId, hash: hash(['payment', userId, adjustmentId, expectedRevision, kind, amountCents, occurredAt]) };
    const replay = this.replay(order, request);
    if (replay) return replay;
    const adjustment = order.priceAdjustment;
    if (!adjustment) throw new NotFoundException('该改价方案不存在');
    if (kind === 'refund') {
      const latest = await this.terminations.recordRefund(clubId, userId, orderId, {
        requestId, terminationId: adjustmentId, expectedRevision, amountCents, occurredAt: input.occurredAt, confirmed: true,
      }, true);
      return priceAdjustmentView(latest);
    }
    const evidence = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order, undefined, true));
    if (evidence.issues.has('pending_reports'))
      throw new ConflictException('本单有补报或更正事项待核对，请先核实费用依据');
    if (amountCents !== adjustment.differenceCents)
      throw new BadRequestException('金额与当前待登记的金额不一致');
    if (occurredAt > recordedAt)
      throw new BadRequestException('实际收退款时间不能晚于现在');
    return this.transition(scope, order, input, request, 'awaiting_supplement', {
      state: 'continuing',
      supplement: { amountCents, occurredAt: occurredAt.toISOString(), recordedAt: recordedAt.toISOString(), recordedByUserId: userId },
    });
  }

  private async transition(
    scope: QueryFilter<ClubOrder>,
    order: ClubOrder,
    { adjustmentId, expectedRevision }: { adjustmentId: string; expectedRevision: number },
    request: StoredPriceAdjustment['requests'][number],
    previousState: StoredPriceAdjustment['state'],
    changes: Partial<StoredPriceAdjustment>,
  ) {
    const adjustment = order.priceAdjustment;
    if (adjustment?.id !== adjustmentId)
      throw new NotFoundException('该改价方案不存在');
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [`priceAdjustment.${key}`, value]),
    );
    if (changes.decision?.value === 'decline') {
      fields.termination = declineTermination(order, {
        ...adjustment, ...changes, revision: adjustment.revision + 1,
      });
    }
    const updated = await this.orders.findOneAndUpdate({
      ...scope,
      _id: order._id,
      dispatchStatus: 'published',
      dispatchWithdrawnAt: null,
      customerLinkStatus: 'verified',
      customerUserId: adjustment.customerUserId,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      pendingDailyReport: null,
      termination: null,
      'priceAdjustment.id': adjustmentId,
      'priceAdjustment.revision': expectedRevision,
      'priceAdjustment.state': previousState,
    }, {
      $set: fields,
      $inc: { 'priceAdjustment.revision': 1 },
      $push: { 'priceAdjustment.requests': request },
    }, { ...durable, new: true }).lean();
    if (updated) return priceAdjustmentView(updated);
    return this.afterConflict(scope, order._id.toHexString(), request);
  }

  private async find(scope: QueryFilter<ClubOrder>, orderId: string) {
    if (!isObjectIdOrHexString(orderId))
      throw new BadRequestException('订单标识格式无效');
    const order = await this.orders.findOne({
      ...scope, _id: orderId, dispatchStatus: 'published',
      'heartDelivery.requestedGiftTimes': { $exists: false },
    }).lean();
    if (!order) throw new NotFoundException('该已派发订单不存在');
    return order;
  }

  private replay(order: ClubOrder, request: StoredPriceAdjustment['requests'][number]) {
    for (const adjustment of [order.priceAdjustment, ...(order.priceAdjustmentHistory ?? [])]) {
      const previous = adjustment?.requests.find(({ id }) => id === request.id);
      if (!previous) continue;
      if (previous.hash !== request.hash)
        throw new ConflictException('同一请求标识已用于不同的改价操作');
      return priceAdjustmentView(order, adjustment);
    }
  }

  private async afterConflict(scope: QueryFilter<ClubOrder>, orderId: string, request: StoredPriceAdjustment['requests'][number]) {
    const current = await this.find(scope, orderId);
    const replay = this.replay(current, request);
    if (replay) return replay;
    throw new ConflictException('订单或改价状态已经变更，请刷新后核对');
  }
}
