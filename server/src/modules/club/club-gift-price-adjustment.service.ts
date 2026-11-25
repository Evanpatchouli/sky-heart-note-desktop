import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftPriceDecision, GiftPricePayment, GiftPricePreview, GiftPriceShift } from '@webapp-template/common';
import { createHash } from 'node:crypto';
import { isObjectIdOrHexString, Model, type QueryFilter, Types } from 'mongoose';
import { ClubDailyReportStore } from './club-daily-report.store';
import { ClubDirectoryService } from './club-directory.service';
import { moveRepricedGifts } from './club-gift-allocation';
import { emptyCounts, addCounts, deliveredGiftTimesBySegment, factCounts, giftDayFacts, receivedHearts, type GiftDayFact } from './club-gift-delivery';
import { canProposeGiftPrice } from './club-gift-execution.service';
import { giftPriceAmendmentView, giftPriceSegments, giftUnfulfilledAmount, type StoredGiftPriceAdjustment } from './club-gift-price-basis';
import { couponCanBeReturned } from './club-gift-termination';
import type { DecideGiftPriceAdjustmentDto, GiftPriceAdjustmentActionDto, ProposeGiftPriceAdjustmentDto, RecordGiftPricePaymentDto } from './club-gift-price-adjustment.dto';
import { ClubOrder } from './club-order.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function actionInput({ adjustmentId, expectedRevision, requestId }: GiftPriceAdjustmentActionDto) {
  return { adjustmentId: adjustmentId.toLowerCase(), expectedRevision, requestId };
}

function shiftInput({ quoteSegment, giftTimes, targetPeriod, targetUnitPriceCents }: GiftPriceShift): GiftPriceShift {
  return { quoteSegment, giftTimes, targetPeriod, targetUnitPriceCents };
}

function pastTime(occurredAt: string) {
  const time = new Date(occurredAt);
  if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now())
    throw new BadRequestException('请填写实际发生的时间');
  return time.toISOString();
}

function currentPrice(order: ClubOrder) {
  const { priceAdjustment } = giftPriceAmendmentView(order);
  return priceAdjustment?.cumulativeReceivedCents ?? (order.continuationQuotes ?? []).reduce(
    (sum, item) => sum + (item.receipt?.receivedAmountCents ?? 0), order.receipt!.receivedAmountCents,
  );
}

function calculatePreview(order: ClubOrder, shift: GiftPriceShift, facts: GiftDayFact[]): GiftPricePreview {
  const basis = giftPriceSegments(order);
  const source = basis[shift.quoteSegment - 1]?.segment;
  if (!source?.paidGiftTimes) throw new BadRequestException('请选择仍有付费次数的计价段');
  const total = emptyCounts();
  for (const fact of facts) addCounts(total, factCounts(fact));
  const deliveredBySegment = deliveredGiftTimesBySegment(order, facts);
  const agreedGiftTimes = basis.reduce((sum, { segment }) => sum + segment.paidGiftTimes + (segment.promotionalGiftTimes ?? 0), 0);
  const deliveredGiftTimes = [...deliveredBySegment.values()].reduce((sum, count) => sum + count, 0);
  const segmentRemainingGiftTimes = source.paidGiftTimes - (deliveredBySegment.get(shift.quoteSegment - 1) ?? 0);
  if (shift.giftTimes > segmentRemainingGiftTimes)
    throw new ConflictException('涉及次数不能超过此段实际未送的付费次数');
  const quoted = currentPrice(order);
  const difference = BigInt(shift.giftTimes) * (BigInt(shift.targetUnitPriceCents) - BigInt(source.unitPriceCents));
  const proposed = BigInt(quoted) + difference;
  const gross = basis.reduce((sum, { segment }) => sum +
    BigInt(segment.paidGiftTimes + (segment.promotionalGiftTimes ?? 0)) * BigInt(segment.unitPriceCents), 0n);
  if (difference > BigInt(Number.MAX_SAFE_INTEGER) || difference < BigInt(Number.MIN_SAFE_INTEGER) ||
      proposed > BigInt(Number.MAX_SAFE_INTEGER) || gross + difference > BigInt(Number.MAX_SAFE_INTEGER))
    throw new BadRequestException('改价金额超出可记录的范围');
  const differenceCents = Number(difference);
  const refund = giftUnfulfilledAmount(order, deliveredBySegment);
  const unavailable = !canProposeGiftPrice(order) || order.customerLinkStatus !== 'verified' || !order.customerUserId
    ? 'adjustment_unavailable'
    : !differenceCents ? 'no_price_change'
    : differenceCents < 0 ? 'lower_price' : null;
  const values = {
    ...shift, originalQuoteCents: order.receipt!.quote.totalAmountCents,
    currentQuoteCents: quoted, cumulativeReceivedCents: quoted, originalPeriod: source.period,
    agreedGiftTimes, deliveredGiftTimes, remainingGiftTimes: agreedGiftTimes - deliveredGiftTimes,
    segmentRemainingGiftTimes, actualReceivedHearts: receivedHearts(total).actualReceivedHearts,
    originalUnitPriceCents: source.unitPriceCents, differenceCents, proposedTotalCents: Number(proposed),
    refundIfDeclinedCents: refund,
  };
  return {
    ...values,
    adjustmentReview: unavailable ? { unavailable } : { version: digest([
      order._id, order.customerUserId, order.fulfillmentRevision ?? 0, order.continuationRevision ?? 0, values,
    ]) },
  };
}

@Injectable()
export class ClubGiftPriceAdjustmentService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly dailyReports: ClubDailyReportStore,
    private readonly directory: ClubDirectoryService,
  ) {}

  private async find(scope: QueryFilter<ClubOrder>, orderId: string) {
    if (!isObjectIdOrHexString(orderId)) throw new NotFoundException('未找到订单');
    const order = await this.orders.findOne({
      ...scope, _id: orderId, dispatchStatus: 'published', 'dispatchPricing.priceUnit': 'gift_times',
    }).lean();
    if (!order?.receipt || order.receipt.receivedAmountCents !== order.receipt.quote.totalAmountCents)
      throw new NotFoundException('未找到已核款派发的按次订单');
    if (!order.pendingDailyReport) return order;
    await this.dailyReports.flushPendingReport(order);
    return this.find(scope, orderId);
  }

  private facts(order: ClubOrder) {
    return giftDayFacts(this.orders.db.collection('club_daily_reports'), order);
  }

  async preview(clubId: string, userId: string, orderId: string, input: GiftPriceShift) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.find({ clubId, dispatcherUserId: userId }, orderId);
    return calculatePreview(order, shiftInput(input), await this.facts(order));
  }

  private async refundDue(order: ClubOrder) {
    return giftUnfulfilledAmount(order, deliveredGiftTimesBySegment(order, await this.facts(order)));
  }

  private async view(order: ClubOrder) {
    return giftPriceAmendmentView(order, order.giftPriceAdjustmentState === 'stopped' ? await this.refundDue(order) : undefined);
  }

  private async replay(order: ClubOrder, id: string, hash: string) {
    if (order.giftTermination?.requests.some(request => request.id === id))
      throw new ConflictException('同一请求标识已用于本单的停送或退款登记');
    const history = order.giftPriceAdjustments ?? [];
    const index = history.findIndex(adjustment => adjustment.requests.some(request => request.id === id));
    if (index < 0) return;
    if (history[index].requests.find(request => request.id === id)!.hash !== hash)
      throw new ConflictException('同一请求标识已用于不同的改价操作');
    const view = await this.view(order);
    return index === history.length - 1 ? view.priceAdjustment : view.priceAdjustmentHistory?.[index];
  }

  private async write(order: ClubOrder, scope: QueryFilter<ClubOrder>,
    history: StoredGiftPriceAdjustment[], requestId: string, hash: string, giftDispatch = order.giftDispatch) {
    const state = history.at(-1)!.state;
    const stoppedAt = state === 'stopped' && order.giftPriceAdjustmentState !== 'stopped' &&
      order.activePromotionCouponId && couponCanBeReturned(order, await this.facts(order)) ? history.at(-1)!.decision!.recordedAt : undefined;
    const { modifiedCount } = await this.orders.updateOne({
      ...scope, _id: order._id, dispatchStatus: 'published', 'dispatchPricing.priceUnit': 'gift_times',
      customerUserId: order.customerUserId ?? null, customerLinkStatus: order.customerLinkStatus,
      closedAt: null, giftTermination: null, pendingDailyReport: null,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      continuationRevision: order.continuationRevision ?? { $in: [null, 0] },
    }, {
      $set: { giftPriceAdjustments: history, giftPriceAdjustmentState: state, giftDispatch,
        ...(stoppedAt ? { promotionCouponReturnedAt: stoppedAt } : {}) },
      ...(stoppedAt ? { $unset: { activePromotionCouponId: 1 } } : {}),
      $inc: { fulfillmentRevision: 1 },
    }, durable);
    if (modifiedCount) return (await this.view({ ...order, giftPriceAdjustments: history, giftPriceAdjustmentState: state })).priceAdjustment!;
    const latest = await this.find(scope, order._id.toHexString());
    const replay = await this.replay(latest, requestId, hash);
    if (replay) return replay;
    throw new ConflictException('订单或履约已有更新，请刷新后核对');
  }

  async propose(clubId: string, userId: string, orderId: string, input: ProposeGiftPriceAdjustmentDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { reason, requestId, expectedVersion } = input;
    const shift = shiftInput(input);
    const hash = digest(['propose', userId, reason, expectedVersion, shift]);
    const prior = await this.replay(order, requestId, hash);
    if (prior) return prior;
    const facts = await this.facts(order);
    const preview = calculatePreview(order, shift, facts);
    if (!('version' in preview.adjustmentReview) || preview.adjustmentReview.version !== expectedVersion)
      throw new ConflictException('当前报价或实绩无法提交改价，请重新试算');
    const ids = new Set(order.giftDispatch?.segments.find(segment => segment.segmentIndex === shift.quoteSegment - 1)?.shares.map(share => share.id));
    const earliestBusinessDate = facts.filter(fact => ids.has(fact._id.shareId.toHexString()) && factCounts(fact).times > 0n)
      .map(fact => fact._id.businessDate).sort().at(-1);
    const now = new Date().toISOString();
    const last = order.giftPriceAdjustments?.at(-1);
    const holdStartedAt = last?.state === 'needs_requote' ? last.holdStartedAt ?? last.submittedAt : now;
    const change: StoredGiftPriceAdjustment = {
      id: new Types.ObjectId().toHexString(), revision: 1, state: 'awaiting_decision', preview, reason,
      requestId, submittedByUserId: userId, submittedAt: now, holdStartedAt, payments: [],
      requests: [{ id: requestId, hash }], ...(earliestBusinessDate ? { earliestBusinessDate } : {}),
    };
    return this.write(order, scope, [...(order.giftPriceAdjustments ?? []), change], requestId, hash);
  }

  async resume(clubId: string, userId: string, orderId: string, input: GiftPriceAdjustmentActionDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    return this.change(scope, orderId, input, digest(['resume', userId, actionInput(input)]), (_order, change) => {
      if (change.state !== 'needs_requote') throw new ConflictException('仅已失效的改价可恢复原约定');
      change.state = 'superseded';
      change.resumed = { requestId: input.requestId, recordedByUserId: userId, recordedAt: new Date().toISOString() };
    });
  }

  async decide(clubId: string, userId: string, orderId: string, input: DecideGiftPriceAdjustmentDto,
    offline?: { occurredAt: string; evidence: string }) {
    const scope = offline ? { clubId, dispatcherUserId: userId } : { clubId, customerUserId: userId, customerLinkStatus: 'verified' };
    if (offline) await this.directory.requireMember(clubId, userId);
    else await this.directory.requireClub(clubId);
    return this.change(scope, orderId, input, digest(['decision', userId, actionInput(input), input.decision, offline]), (_order, change) => {
      if (change.state !== 'awaiting_decision') throw new ConflictException('此改价已答复');
      const now = new Date().toISOString();
      const decision: GiftPriceDecision = {
        value: input.decision, source: offline ? 'offline' : 'customer', decidedByUserId: userId,
        decidedAt: offline ? pastTime(offline.occurredAt) : now, recordedAt: now, requestId: input.requestId,
        ...(offline ? { evidence: offline.evidence } : {}),
      };
      change.decision = decision;
      change.state = decision.value === 'accept' ? 'awaiting_supplement' : 'stopped';
    });
  }

  async payment(clubId: string, userId: string, orderId: string, input: RecordGiftPricePaymentDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const { kind, amountCents, reason, occurredAt, requestId } = input;
    const occurred = pastTime(occurredAt);
    return this.change(scope, orderId, input, digest(['payment', userId, actionInput(input), kind, amountCents, reason, occurred]),
      async (order, change) => {
        if (kind === 'refund' && Date.parse(occurred) < order.receipt!.receivedAt.getTime())
          throw new BadRequestException('实际退款时间须在原收款与当前时间之间');
        if (change.payments.some(item => item.kind === kind && item.amountCents === amountCents && item.occurredAt === occurred))
          throw new ConflictException('此时间及金额的款项已登记，请勿重复记录');
        let refundDueAtRecordingCents: number | undefined;
        if (kind === 'supplement') {
          if (change.state !== 'awaiting_supplement' || amountCents !== change.preview.differenceCents)
            throw new ConflictException('请在同意补差后登记足额实补');
          const shift = change.preview;
          const basis = giftPriceSegments(order);
          const sourceIndex = shift.quoteSegment - 1;
          const byShare = new Map<string, Map<string, number>>();
          for (const fact of await this.facts(order)) {
            const id = fact._id.shareId.toHexString();
            const byDate = byShare.get(id) ?? new Map<string, number>();
            byDate.set(fact._id.businessDate, Number(factCounts(fact).times));
            byShare.set(id, byDate);
          }
          moveRepricedGifts(order.giftDispatch!, sourceIndex, basis[sourceIndex].segment, basis.length, shift.giftTimes, byShare);
          change.newQuoteSegment = basis.length + 1;
          change.state = 'continuing';
        } else {
          if (change.state !== 'stopped') throw new ConflictException('此改价未进入拒补停送');
          refundDueAtRecordingCents = await this.refundDue(order);
          const refunded = change.payments.reduce((sum, item) => sum + item.amountCents, 0);
          if (amountCents > refundDueAtRecordingCents - refunded)
            throw new ConflictException('实退金额不能超过该笔拒补订单的待退余额');
        }
        const payment: GiftPricePayment = {
          kind, amountCents, reason: reason ?? change.reason, occurredAt: occurred,
          recordedAt: new Date().toISOString(), recordedByUserId: userId, requestId,
          ...(refundDueAtRecordingCents === undefined ? {} : { refundDueAtRecordingCents }),
        };
        change.payments.push(payment);
      });
  }

  private async change(scope: QueryFilter<ClubOrder>, orderId: string,
    input: GiftPriceAdjustmentActionDto, hash: string,
    mutate: (order: ClubOrder, change: StoredGiftPriceAdjustment) => Promise<void> | void) {
    const order = await this.find(scope, orderId);
    const { adjustmentId, expectedRevision, requestId } = actionInput(input);
    const prior = await this.replay(order, requestId, hash);
    if (prior) return prior;
    const history = order.giftPriceAdjustments ?? [];
    const change = history.at(-1);
    if (!change || change.id !== adjustmentId || change.revision !== expectedRevision || order.closedAt || order.giftTermination)
      throw new ConflictException('改价已有更新，请刷新后核对');
    await mutate(order, change);
    change.revision += 1;
    change.requests.push({ id: requestId, hash });
    return this.write(order, scope, history, requestId, hash);
  }
}
