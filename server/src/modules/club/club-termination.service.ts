import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { OrderTermination, TerminationReview } from '@sky-club/common';
import { createHash } from 'node:crypto';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { customerFulfillmentView } from './club-delivery';
import { compareDeliveryPrice, summarizeDeliveryPeriods } from './club-delivery-review';
import { ClubDeliveryService } from './club-delivery.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubOrder } from './club-order.schema';
import { effectivePriceSegments, priceAdjustmentView } from './club-price-adjustment';
import {
  dispatchTerminationView, originalPricesBySegment, storedTermination, terminationView,
  type StoredTermination, type TerminationRequest,
} from './club-termination';
import type {
  ConfirmTerminationTermsDto, RecordTerminationChangeDto, RecordTerminationRefundDto, RequestTerminationDto,
} from './club-termination.dto';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

function requestFact(id: string, ...facts: unknown[]): TerminationRequest {
  return { id, hash: createHash('sha256').update(JSON.stringify(facts)).digest('hex') };
}

function wasRecorded(order: ClubOrder, request: TerminationRequest) {
  const saved = order.termination?.requests.find(({ id }) => id === request.id);
  if (saved && saved.hash !== request.hash)
    throw new ConflictException('同一请求标识已用于不同的停送或退款登记');
  return !!saved;
}

@Injectable()
export class ClubTerminationService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly delivery: ClubDeliveryService,
  ) {}

  async request(clubId: string, userId: string, orderId: string, { requestId, reason = '' }: RequestTerminationDto) {
    const scope = { clubId, customerUserId: userId, customerLinkStatus: 'verified' as const };
    const current = await this.find(scope, orderId);
    const request = requestFact(requestId, 'stop', userId, reason);
    if (wasRecorded(current, request)) return terminationView(current)!;
    const stop = await this.prepareStop(current, 'customer_request', reason);
    return terminationView(await this.save(scope, current, stop, request))!;
  }

  async change(clubId: string, userId: string, orderId: string, input: RecordTerminationChangeDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { expectedRevision, requestId, reason, heartRule, customerRequestReference, priorPostingReference } = input;
    const request = requestFact(requestId, 'terms', userId, expectedRevision, reason, heartRule, customerRequestReference, priorPostingReference);
    if (wasRecorded(order, request)) return dispatchTerminationView(order)!;
    const existing = storedTermination(order);
    if ((existing?.revision ?? 0) !== expectedRevision)
      throw new ConflictException('停送或退款约定已更新，请刷新后核对');
    if (existing?.change?.customerConfirmedAt || existing?.origin === 'declined_adjustment') {
      if (!priorPostingReference || existing.priorPostingReference || customerRequestReference)
        throw new ConflictException('本单已有客户答复，可补记既有入账待核依据');
      return dispatchTerminationView(await this.save(scope, order, {
        ...existing, priorPostingReference, priorPostingReason: reason, revision: existing.revision + 1,
      }, request))!;
    }
    if (!existing && !customerRequestReference)
      throw new ConflictException('请登记已收到的客户停送依据');
    if (existing && customerRequestReference)
      throw new ConflictException('本单已有停送来源记录');
    const stop = existing ?? await this.prepareStop(order, 'reported_customer_request', reason);
    const change: OrderTermination['change'] = {
      reason, heartRule, recordedByUserId: userId, recordedAt: new Date().toISOString(),
    };
    return dispatchTerminationView(await this.save(scope, order, {
      ...stop,
      revision: existing ? existing.revision + 1 : 1,
      change,
      ...(existing?.change ? { changeHistory: [...(existing.changeHistory ?? []), existing.change] } : {}),
      ...(customerRequestReference ? { customerRequestReference } : {}),
      ...(priorPostingReference ? { priorPostingReference, priorPostingReason: reason } : {}),
    }, request))!;
  }

  async confirm(clubId: string, userId: string, orderId: string, { expectedRevision, requestId, terminationId }: ConfirmTerminationTermsDto) {
    const scope = { clubId, customerUserId: userId, customerLinkStatus: 'verified' as const };
    const order = await this.find(scope, orderId);
    const request = requestFact(requestId, 'confirm', userId, terminationId, expectedRevision);
    if (wasRecorded(order, request)) return terminationView(order)!;
    const stop = storedTermination(order);
    if (!stop || stop.id !== terminationId) throw new NotFoundException('本单没有该项停送记录');
    if (stop.revision !== expectedRevision || !stop.change || stop.change.customerConfirmedAt)
      throw new ConflictException('退款约定已变化或已确认，请刷新后核对');
    const change = {
      ...stop.change, customerConfirmedAt: new Date().toISOString(), customerConfirmedByUserId: userId,
    };
    return terminationView(await this.save(scope, order, { ...stop, change, revision: stop.revision + 1 }, request))!;
  }

  async recordRefund(
    clubId: string, userId: string, orderId: string,
    { expectedRevision, requestId, terminationId, amountCents, occurredAt: inputTime }: RecordTerminationRefundDto,
    legacyRoute = false,
  ) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const occurredAt = new Date(inputTime);
    const recordedAt = new Date();
    const request = requestFact(requestId, 'refund', userId, terminationId, expectedRevision, amountCents, occurredAt);
    if (wasRecorded(order, request)) return order;
    const stop = storedTermination(order);
    if (!stop || stop.id !== terminationId || (legacyRoute && !stop.adjustmentId))
      throw new NotFoundException('本单没有该项停送退款记录');
    const legacyRequest = order.priceAdjustment?.requests.find(({ id }) => id === requestId);
    if (legacyRequest && stop.adjustmentId === terminationId && stop.refunds.some(({ id }) => id === requestId) &&
        legacyRequest.hash === requestFact(requestId, 'payment', userId, terminationId, expectedRevision, 'refund', amountCents, occurredAt).hash)
      return order;
    if (legacyRequest || order.priceAdjustmentHistory?.some((adjustment) => adjustment.requests.some(({ id }) => id === requestId)))
      throw new ConflictException('同一请求标识已用于本单的改价操作');
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt > recordedAt || (order.receipt && occurredAt < order.receipt.receivedAt))
      throw new BadRequestException('实际退款时间须在原收款与当前时间之间');
    if (stop.revision !== expectedRevision)
      throw new ConflictException('退款记录已更新，请刷新后核对本次款项是否已登记');
    const view = terminationView(order)!;
    if (view.refundRemainingCents === null || amountCents > view.refundRemainingCents)
      throw new ConflictException('当前可核对的待退金额不足，请核对退款依据及已退记录');
    const reports = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order, undefined, true));
    if (reports.issues.has('pending_reports'))
      throw new ConflictException('补报或更正可能影响应退心款，待核对后再登记相应金额');
    const fact = {
      id: requestId, amountCents, occurredAt: occurredAt.toISOString(), recordedAt: recordedAt.toISOString(), recordedByUserId: userId,
    };
    return this.save(scope, order, { ...stop, revision: stop.revision + 1, refunds: [...stop.refunds, fact] }, request);
  }

  private async prepareStop(order: ClubOrder, origin: StoredTermination['origin'], reason: string): Promise<StoredTermination> {
    if (storedTermination(order)) throw new ConflictException('本单已停送，可在订单内核对退款进展');
    const reports = summarizeDeliveryPeriods(order, await this.delivery.periodRows(order, undefined, true));
    const progress = customerFulfillmentView(order, reports.totals);
    if (!progress.remainingHearts) throw new ConflictException('本单没有剩余需停止的送心');
    const comparison = compareDeliveryPrice(order, progress, reports);
    const activity = comparison.issues.includes('promotion_allocation');
    const basisUnclear = comparison.issues.some((issue) =>
      !['incomplete', 'promotion_allocation', 'formal_adjustment_recorded'].includes(issue));
    const { receipt, dispatchPricing } = order;
    const originalPrices = originalPricesBySegment(order);
    const effective = effectivePriceSegments(order, receipt?.quote.segments ?? dispatchPricing?.segments ?? []);
    const segments = reports.breakdown.segments.map(({ number, period, plannedHearts, receivedHearts, pendingHearts }) => ({
      number, period, plannedHearts, observedHearts: receivedHearts, unfulfilledHearts: pendingHearts ?? 0,
      originalUnitPriceCents: originalPrices[number - 1] ?? effective[number - 1].unitPriceCents,
      effectiveUnitPriceCents: effective[number - 1].unitPriceCents,
    }));
    const paid = receipt?.receivedAmountCents ?? null;
    const totalPaid = priceAdjustmentView(order)?.cumulativeReceivedCents ?? paid;
    const supplementReceivedCents = paid === null || totalPaid === null ? 0 : totalPaid - paid;
    const originalPending = segments.reduce((sum, row) => sum + row.unfulfilledHearts * row.originalUnitPriceCents, 0);
    const currentPending = segments.reduce((sum, row) => sum + row.unfulfilledHearts * row.effectiveUnitPriceCents, 0);
    const reviewAtStop: TerminationReview[] = [];
    if (activity) reviewAtStop.push('activity_pending');
    if (basisUnclear || paid === null ||
        !Number.isSafeInteger(currentPending) || currentPending > paid + supplementReceivedCents ||
        segments.reduce((sum, row) => sum + row.unfulfilledHearts, 0) !== progress.remainingHearts)
      reviewAtStop.push('delivery_basis_pending');
    const known = !reviewAtStop.length;
    return {
      id: new Types.ObjectId().toHexString(), revision: 1, origin, reason, stoppedAt: new Date().toISOString(),
      ...(order.customerLinkStatus === 'verified' ? { customerUserId: order.customerUserId } : {}),
      observedHearts: progress.observedHearts, stoppedHearts: progress.remainingHearts, originalReceivedCents: paid,
      supplementReceivedCents, originalUnfulfilledCents: known ? originalPending : null,
      supplementUnfulfilledCents: known ? currentPending - originalPending : null,
      receiptRevision: receipt?.quote.revision ?? null, fulfillmentRevision: order.fulfillmentRevision ?? 0,
      segments, reviewAtStop, refunds: [], requests: [],
    };
  }

  private async find(scope: QueryFilter<ClubOrder>, orderId: string) {
    if (!isObjectIdOrHexString(orderId)) throw new BadRequestException('订单标识格式无效');
    const order = await this.orders.findOne({
      ...scope, _id: orderId, dispatchStatus: 'published',
      'heartDelivery.requestedGiftTimes': { $exists: false },
    }).lean();
    if (!order) throw new NotFoundException('该已派发订单不存在');
    if (!order.pendingDailyReport) return order;
    await this.delivery.flushPendingReport(order);
    const latest = await this.orders.findOne({
      ...scope, _id: orderId, dispatchStatus: 'published',
      'heartDelivery.requestedGiftTimes': { $exists: false },
    }).lean();
    if (!latest) throw new NotFoundException('该已派发订单不存在');
    return latest;
  }

  private async save(scope: QueryFilter<ClubOrder>, order: ClubOrder, termination: StoredTermination, request: TerminationRequest) {
    const stored = { ...termination, requests: [...termination.requests, request] };
    const set: Record<string, unknown> = { termination: stored };
    if (termination.adjustmentId) {
      const projected = terminationView({ ...order, termination })!;
      set['priceAdjustment.revision'] = termination.revision;
      set['priceAdjustment.state'] = projected.refundRemainingCents === 0 ? 'refunded' : 'refund_due';
    }
    const result = await this.orders.findOneAndUpdate({
      ...scope, _id: order._id, dispatchStatus: 'published',
      customerLinkStatus: order.customerLinkStatus, customerUserId: order.customerUserId ?? null,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] }, pendingDailyReport: null,
      'priceAdjustment.id': order.priceAdjustment?.id ?? null,
      'priceAdjustment.revision': order.priceAdjustment?.revision ?? null,
      'termination.id': order.termination?.id ?? null,
      'termination.revision': order.termination?.revision ?? null,
    }, {
      $set: set,
      // Materializing a historical stop moves its old payment into the same
      // refund history used by all new writes. The legacy request stays replayable.
      ...(termination.adjustmentId && order.priceAdjustment?.refund ? { $unset: { 'priceAdjustment.refund': 1 } } : {}),
    }, { ...durable, new: true }).lean();
    if (result) return result;
    const latest = await this.find(scope, order._id.toHexString());
    if (wasRecorded(latest, request)) return latest;
    throw new ConflictException('订单、实绩或款项已变化，请刷新后核对');
  }
}
