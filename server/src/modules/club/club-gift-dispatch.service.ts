import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { GiftClaimOrder, GiftDispatchPreparation, GiftPriceSegment, GiftSegmentDispatchInput } from '@webapp-template/common';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { ClubDirectoryService } from './club-directory.service';
import {
  awardGiftShare, buildGiftSegments, directedGiftDays, emptyGiftDispatch, giftDispatchFingerprint, giftOfferView,
  giftSegmentView, publicGiftDays, transferGiftDays, type GiftDispatchState,
} from './club-gift-allocation';
import type { ClaimGiftDispatchDto, ConfigureGiftDispatchDto, ReassignGiftDispatchDto } from './club-gift-dispatch.dto';
import { ClubOrder } from './club-order.schema';

const claimable = {
  dispatchStatus: 'published' as const,
  'dispatchPricing.priceUnit': 'gift_times',
  dispatchWithdrawnAt: null,
  termination: null,
  'priceAdjustment.state': { $in: [null, 'continuing'] },
};
const durable = { writeConcern: { w: 'majority', j: true } } as const;
const concurrentChange = () => new ConflictException('订单分工或履约正在更新，请重新加载后重试');

function eligibleOrder(order: ClubOrder) {
  if (order.dispatchPricing?.priceUnit !== 'gift_times' || order.receipt?.quote.priceUnit !== 'gift_times' ||
      order.receipt.receivedAmountCents !== order.receipt.quote.totalAmountCents)
    throw new ConflictException('仅已核款并正式派发的按次订单可以分工');
  return order.dispatchPricing.giftSegments ?? [];
}

function matchReplay(saved: { fingerprint: string }, fingerprint: string) {
  if (saved.fingerprint !== fingerprint) throw new ConflictException('相同提交标识已用于不同的操作内容');
}

function readOrder(order: ClubOrder, userId: string): GiftClaimOrder {
  const authorizedSegments = (order.giftDispatch?.segments ?? []).filter(segment =>
    segment.openToClaim || segment.offers.some(offer => offer.userId === userId) ||
    segment.shares.some(share => share.userId === userId),
  );
  const quotes = order.dispatchPricing!.giftSegments ?? [];
  const segments = authorizedSegments.map(segment => giftSegmentView(segment, quotes[segment.segmentIndex], userId));
  const { requestedGiftTimes, estimatedReceivedHearts } = order.heartDelivery;
  return {
    id: order._id.toHexString(), source: order.source, dispatcherUserId: order.dispatcherUserId!,
    requestedGiftTimes: requestedGiftTimes!, ...(estimatedReceivedHearts === undefined ? {} : { estimatedReceivedHearts }),
    ...(segments.some(segment => segment.shares.length) || order.dispatcherUserId === userId
      ? { recipientGameAccount: order.recipientGameAccount } : {}),
    segments,
  };
}

@Injectable()
export class ClubGiftDispatchService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
  ) {}

  async prepareInitial(clubId: string, input: GiftSegmentDispatchInput[], quotes: GiftPriceSegment[]) {
    const segments = buildGiftSegments(input, quotes);
    await this.requireCandidates(clubId, input);
    return { ...emptyGiftDispatch(), segments };
  }

  async candidates(clubId: string, userId: string) {
    await this.directory.requireMember(clubId, userId);
    const ids = await this.directory.eligibleGiftMembers(clubId);
    const names = await this.directory.memberNicknames(ids);
    return ids.map(userId => ({ userId, nickname: names.get(userId) ?? null }));
  }

  async preparation(clubId: string, userId: string, orderId: string): Promise<GiftDispatchPreparation> {
    await this.directory.requireMember(clubId, userId);
    const order = await this.getOrder(orderId, { ...claimable, clubId, dispatcherUserId: userId });
    const quotes = eligibleOrder(order);
    const candidates = await this.candidates(clubId, userId);
    const segments = await Promise.all((order.giftDispatch?.segments ?? []).map(async segment => {
      const view = giftSegmentView(segment, quotes[segment.segmentIndex]);
      return { ...view, shares: await Promise.all(view.shares.map(async share => ({
        ...share,
        deliveredGiftTimes: [...(await this.sentGiftTimes(order._id, share.id, share.userId, segment.segmentIndex)).values()]
          .reduce((sum, times) => sum + times, 0),
      }))) };
    }));
    return { quotes, segments, candidates };
  }

  async configure(clubId: string, userId: string, orderId: string, input: ConfigureGiftDispatchDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { ...claimable, clubId, dispatcherUserId: userId };
    const fingerprint = giftDispatchFingerprint(input.segments);
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.getOrder(orderId, scope);
      const quotes = eligibleOrder(order);
      const state = order.giftDispatch ?? emptyGiftDispatch();
      const saved = state.configurations.find(item => item.requestId === input.requestId);
      if (saved) {
        matchReplay(saved, fingerprint);
        return this.preparation(clubId, userId, orderId);
      }
      if (input.segments.some(next => state.segments.some(segment => next.segmentIndex === segment.segmentIndex)))
        throw new ConflictException('该报价段已完成派发，请在现有份额上改派');
      const segments = buildGiftSegments(input.segments, quotes);
      await this.requireCandidates(clubId, input.segments);
      state.segments.push(...segments);
      state.configurations.push({ requestId: input.requestId, fingerprint });
      if (await this.save(order, scope, state)) return this.preparation(clubId, userId, orderId);
    }
    throw concurrentChange();
  }

  async list(clubId: string, userId: string, after?: string) {
    await this.directory.requireMember(clubId, userId);
    const limit = 25;
    const orders = await this.orders.find({
      ...this.claimScope(clubId, userId), ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
    }).sort({ _id: -1 }).limit(limit + 1).lean();
    return { items: orders.slice(0, limit).map(order => readOrder(order, userId)),
      nextCursor: orders.length > limit ? orders[limit - 1]._id.toHexString() : null };
  }

  async detail(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    return readOrder(await this.getOrder(orderId, this.claimScope(clubId, userId)), userId);
  }

  async claim(clubId: string, userId: string, orderId: string, input: ClaimGiftDispatchDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = this.claimScope(clubId, userId);
    const { requestId, segmentIndex, kind, dailyGiftTimes, actualReceivedHearts } = input;
    const offerId = input.offerId?.toLowerCase();
    if (kind === 'public' && offerId !== undefined || kind === 'directed' && dailyGiftTimes !== undefined)
      throw new BadRequestException('公开抢单填写日量，定向接单确认指定份额');
    const fingerprint = JSON.stringify([segmentIndex, kind, offerId, dailyGiftTimes, actualReceivedHearts]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.getOrder(orderId, scope);
      const quotes = eligibleOrder(order);
      const state = order.giftDispatch!;
      const saved = state.claims.find(item => item.requestId === requestId && item.userId === userId);
      if (saved) {
        matchReplay(saved, fingerprint);
        return saved.result;
      }
      const segment = state.segments.find(item => item.segmentIndex === segmentIndex);
      if (!segment) throw new NotFoundException('该段还没有分工');
      let days: ReturnType<typeof publicGiftDays>;
      if (kind === 'public') {
        if (!segment.openToClaim) throw new ForbiddenException('此段仅接受定向承接');
        if (segment.shares.some(share => share.userId === userId && share.kind === 'public'))
          throw new ConflictException('你已在本段领取公开份额');
        days = publicGiftDays(segment, quotes[segmentIndex], dailyGiftTimes!);
      } else {
        const offer = segment.offers.find(item => item.id === offerId && item.userId === userId);
        if (!offer) throw new ForbiddenException('本段没有此项指定给你的份额');
        if (offer.accepted) throw new ConflictException('你已确认承接此份额');
        days = directedGiftDays(offer);
      }
      const result = awardGiftShare(segment, kind, userId, days, actualReceivedHearts);
      state.claims.push({ requestId, userId, fingerprint, result });
      if (await this.save(order, scope, state)) return result;
    }
    throw concurrentChange();
  }

  async reassign(clubId: string, userId: string, orderId: string, input: ReassignGiftDispatchDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = { ...claimable, clubId, dispatcherUserId: userId };
    const shareId = input.shareId.toLowerCase();
    const fingerprint = JSON.stringify([shareId, input.userId, input.giftTimes]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const order = await this.getOrder(orderId, scope);
      eligibleOrder(order);
      const state = order.giftDispatch ?? emptyGiftDispatch();
      const saved = state.transfers.find(item => item.requestId === input.requestId);
      if (saved) {
        matchReplay(saved, fingerprint);
        return saved.result;
      }
      const segment = state.segments.find(item => item.shares.some(share => share.id === shareId));
      const share = segment?.shares.find(item => item.id === shareId);
      if (!segment || !share) throw new NotFoundException('本单没有此按次承接份额');
      if (share.userId === input.userId) throw new BadRequestException('请选择另一位接手团员');
      if (order.pendingDailyReport) throw concurrentChange();
      await this.directory.requireAssignmentCandidate(clubId, input.userId);
      const sent = await this.sentGiftTimes(order._id, share.id, share.userId, segment.segmentIndex);
      const offer = transferGiftDays(share, sent, input.userId, input.giftTimes);
      const result = giftOfferView(offer);
      segment.offers.push(offer);
      state.transfers.push({ requestId: input.requestId, fingerprint, result });
      if (await this.save(order, scope, state)) return result;
    }
    throw concurrentChange();
  }

  private claimScope(clubId: string, userId: string): QueryFilter<ClubOrder> {
    return {
      ...claimable, clubId,
      $or: [
        { 'giftDispatch.segments.openToClaim': true },
        { 'giftDispatch.segments.offers.userId': userId },
        { 'giftDispatch.segments.shares.userId': userId },
      ],
    };
  }

  private async getOrder(id: string, scope: QueryFilter<ClubOrder>) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('订单标识格式无效');
    const order = await this.orders.findOne({ ...scope, _id: id }).lean();
    if (!order) throw new NotFoundException('当前没有可操作的已派发按次订单');
    return order;
  }

  private async requireCandidates(clubId: string, input: GiftSegmentDispatchInput[]) {
    const ids = [...new Set(input.flatMap(segment => segment.directed.map(item => item.userId)))];
    await Promise.all(ids.map(id => this.directory.requireAssignmentCandidate(clubId, id)));
  }

  private async save(order: ClubOrder, scope: QueryFilter<ClubOrder>, state: GiftDispatchState) {
    const { modifiedCount } = await this.orders.updateOne({
      ...scope, _id: order._id, pendingDailyReport: null,
      fulfillmentRevision: order.fulfillmentRevision ?? { $in: [null, 0] },
    }, { $set: { giftDispatch: state }, $inc: { fulfillmentRevision: 1 } }, durable);
    return modifiedCount === 1;
  }

  private async sentGiftTimes(orderId: Types.ObjectId, shareId: string, userId: string, segmentIndex: number) {
    // A pending write blocks reassignment until the report is durable.
    // The latest version of each gift report carries the effective quantities.
    const rows = await this.orders.db.collection('club_daily_reports').aggregate<{ _id: string; giftTimes: number }>([
      { $match: { orderId, shareId: new Types.ObjectId(shareId), userId } },
      { $sort: { version: -1 } },
      { $group: { _id: { $ifNull: ['$originalId', '$_id'] }, lines: { $first: '$lines' }, businessDate: { $first: '$businessDate' } } },
      { $unwind: '$lines' },
      { $match: { 'lines.quoteSegment': { $in: [null, segmentIndex + 1] } } },
      { $group: { _id: '$businessDate', giftTimes: { $sum: '$lines.giftTimes' } } },
    ]).toArray();
    const total = rows.reduce((sum, { giftTimes }) => sum + giftTimes, 0);
    if (!Number.isSafeInteger(total) || rows.some(row => !Number.isSafeInteger(row.giftTimes) || row.giftTimes < 0))
      throw new ConflictException('该份额已送次数需要核对');
    return new Map(rows.map(row => [row._id, row.giftTimes]));
  }
}
