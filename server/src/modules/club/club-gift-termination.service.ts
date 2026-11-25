import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { isObjectIdOrHexString, Model, type QueryFilter, Types } from 'mongoose';
import { ClubDailyReportStore } from './club-daily-report.store';
import { ClubDirectoryService } from './club-directory.service';
import { deliveredGiftTimesBySegment, giftDayFacts } from './club-gift-delivery';
import { ClubGiftPriceAdjustmentService } from './club-gift-price-adjustment.service';
import {
  canTerminateGiftOrder, couponCanBeReturned, customerGiftTermination, giftTerminationView, remainingContractedGiftTimes,
  type GiftTerminationRequest, type StoredGiftTermination,
} from './club-gift-termination';
import type { RequestGiftTerminationDto, RecordGiftTerminationChangeDto, RecordGiftTerminationRefundDto } from './club-gift-termination.dto';
import { ClubOrder } from './club-order.schema';

const durable = { writeConcern: { w: 'majority', j: true } } as const;

function operation(id: string, ...facts: unknown[]) {
  return { id, hash: createHash('sha256').update(JSON.stringify(facts)).digest('hex') };
}

function wasRecorded(order: ClubOrder, request: GiftTerminationRequest) {
  const saved = order.giftTermination?.requests.find(item => item.id === request.id);
  if (saved && saved.hash !== request.hash ||
      order.giftPriceAdjustments?.some(item => item.requests.some(action => action.id === request.id)))
    throw new ConflictException('同一请求标识已用于本单的其他操作');
  return !!saved;
}

@Injectable()
export class ClubGiftTerminationService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly reports: ClubDailyReportStore,
    private readonly directory: ClubDirectoryService,
    private readonly amendments: ClubGiftPriceAdjustmentService,
  ) {}

  async handles(clubId: string, orderId: string) {
    return isObjectIdOrHexString(orderId) && !!await this.orders.exists({
      clubId, _id: orderId, 'heartDelivery.requestedGiftTimes': { $exists: true },
    });
  }

  private async find(scope: QueryFilter<ClubOrder>, orderId: string): Promise<ClubOrder> {
    if (!isObjectIdOrHexString(orderId)) throw new NotFoundException('未找到订单');
    const order = await this.orders.findOne({ ...scope, _id: orderId, 'heartDelivery.requestedGiftTimes': { $exists: true } }).lean();
    if (!order) throw new NotFoundException('未找到按次订单');
    if (!order.pendingDailyReport) return order;
    await this.reports.flushPendingReport(order);
    return this.find(scope, orderId);
  }

  private facts(order: ClubOrder) {
    return giftDayFacts(this.orders.db.collection('club_daily_reports'), order);
  }

  private async view(order: ClubOrder) {
    return giftTerminationView(order, deliveredGiftTimesBySegment(order, await this.facts(order)))!;
  }

  private start(order: ClubOrder, delivered: ReadonlyMap<number, number>,
    origin: StoredGiftTermination['origin'], reason?: string): StoredGiftTermination {
    if (!canTerminateGiftOrder(order, remainingContractedGiftTimes(order, delivered)))
      throw new ConflictException('只有已核款、尚未结单且有剩余次数的订单可停送');
    return { id: new Types.ObjectId().toHexString(), stoppedAt: new Date().toISOString(),
      origin, ...(reason ? { reason } : {}), refunds: [], requests: [] };
  }

  async request(clubId: string, userId: string, orderId: string, { requestId, reason }: RequestGiftTerminationDto) {
    await this.directory.requireClub(clubId);
    const scope = { clubId, customerUserId: userId, customerLinkStatus: 'verified' as const };
    const order = await this.find(scope, orderId);
    const request = operation(requestId, 'stop', userId, reason || undefined);
    if (wasRecorded(order, request)) return customerGiftTermination(await this.view(order));
    const facts = await this.facts(order);
    const delivered = deliveredGiftTimesBySegment(order, facts);
    const stopped = this.start(order, delivered, 'customer_request', reason);
    return customerGiftTermination(await this.save(scope, order, stopped, request, couponCanBeReturned(order, facts)));
  }

  async change(clubId: string, userId: string, orderId: string, input: RecordGiftTerminationChangeDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { requestId, expectedRevision, reason, customerRequestReference } = input;
    const request = operation(requestId, 'change', userId, expectedRevision, reason, customerRequestReference);
    if (wasRecorded(order, request)) return this.view(order);
    const existing = order.giftTermination;
    if (expectedRevision !== (existing ? order.fulfillmentRevision : 0) || order.closedAt ||
        order.giftPriceAdjustmentState === 'stopped')
      throw new ConflictException('订单或停送记录已变化，请刷新后核对');
    if (existing ? !!customerRequestReference : !customerRequestReference)
      throw new ConflictException(existing ? '本单已登记停送来源' : '请登记老板在线下提出停送的依据');
    if (existing?.change) throw new ConflictException('本单已登记停送原因');
    const change = { reason, recordedByUserId: userId, recordedAt: new Date().toISOString() };
    if (existing) return this.save(scope, order, { ...existing, change }, request);
    const facts = await this.facts(order);
    const stopped = this.start(order, deliveredGiftTimesBySegment(order, facts), 'reported_customer_request');
    return this.save(scope, order, { ...stopped, customerRequestReference, change }, request, couponCanBeReturned(order, facts));
  }

  async refund(clubId: string, userId: string, orderId: string, input: RecordGiftTerminationRefundDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { clubId, dispatcherUserId: userId };
    const order = await this.find(scope, orderId);
    const { requestId, expectedRevision, amountCents } = input;
    const terminationId = input.terminationId.toLowerCase();
    if (!order.giftTermination && order.giftPriceAdjustmentState === 'stopped') {
      if (order.giftPriceAdjustments?.at(-1)?.id !== terminationId)
        throw new NotFoundException('本单没有该项停送记录');
      await this.amendments.payment(clubId, userId, orderId, {
        requestId, expectedRevision, adjustmentId: terminationId, kind: 'refund', amountCents, occurredAt: input.occurredAt,
      });
      return this.view(await this.find(scope, orderId));
    }
    const stop = order.giftTermination;
    if (!stop || stop.id !== terminationId) throw new NotFoundException('本单没有该项停送记录');
    const actual = new Date(input.occurredAt);
    const now = new Date();
    if (!Number.isFinite(actual.getTime()) || actual > now || actual < order.receipt!.receivedAt)
      throw new BadRequestException('实际退款时间须在原收款与当前时间之间');
    const occurredAt = actual.toISOString();
    const request = operation(requestId, 'refund', userId, terminationId, expectedRevision, amountCents, occurredAt);
    if (wasRecorded(order, request)) return this.view(order);
    if (order.closedAt || order.fulfillmentRevision !== expectedRevision || !stop.change)
      throw new ConflictException('已结单或退款依据已变化，请核对停送原因和当前款项');
    if (stop.refunds.some(item => item.amountCents === amountCents && item.occurredAt === occurredAt))
      throw new ConflictException('此时间及金额的退款已登记，请勿重复记录');
    const view = await this.view(order);
    if (amountCents > view.refundRemainingCents) throw new ConflictException('实退金额不能超过本单待退金额');
    const payment = {
      kind: 'refund' as const, requestId, amountCents, occurredAt, recordedAt: now.toISOString(),
      recordedByUserId: userId, reason: stop.change.reason, refundDueAtRecordingCents: view.refundDueCents,
    };
    return this.save(scope, order, { ...stop, refunds: [...stop.refunds, payment] }, request);
  }

  private async save(scope: QueryFilter<ClubOrder>, order: ClubOrder, stop: StoredGiftTermination, request: GiftTerminationRequest,
    returnCoupon = false) {
    const updated = await this.orders.findOneAndUpdate({
      ...scope, _id: order._id, dispatchStatus: order.dispatchStatus,
      customerUserId: order.customerUserId ?? null, customerLinkStatus: order.customerLinkStatus,
      closedAt: null, pendingDailyReport: null,
      giftPriceAdjustmentState: order.giftPriceAdjustmentState ?? null,
      'giftTermination.id': order.giftTermination?.id ?? null,
      'receipt.quote.revision': order.receipt?.quote.revision,
      'receipt.receivedAmountCents': order.receipt?.receivedAmountCents,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
      continuationRevision: order.continuationRevision ?? { $in: [null, 0] },
    }, {
      $set: { giftTermination: { ...stop, requests: [...stop.requests, request] },
        ...(returnCoupon ? { promotionCouponReturnedAt: stop.stoppedAt } : {}) },
      ...(returnCoupon ? { $unset: { activePromotionCouponId: 1 } } : {}),
      $inc: { fulfillmentRevision: 1 },
    }, { ...durable, returnDocument: 'after' }).lean();
    if (updated) return this.view(updated);
    const latest = await this.find(scope, order._id.toHexString());
    if (wasRecorded(latest, request)) return this.view(latest);
    throw new ConflictException('订单、实绩或款项已更新，请刷新后核对');
  }
}
