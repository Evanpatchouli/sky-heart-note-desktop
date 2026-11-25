import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { giftSegmentTimes } from '@webapp-template/common';
import type {
  GiftAllocationTotals, GiftClaimOrder, GiftClaimResult, GiftDispatchPreparation, GiftPriceSegment, GiftSegmentDispatchInput,
} from '@webapp-template/common';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import { ClubDirectoryService } from './club-directory.service';
import { ClubDailyReportStore } from './club-daily-report.store';
import { eligiblePromotionalFacts, giftDayFacts } from './club-gift-delivery';
import {
  activeGiftSegments, awardGiftShare, buildGiftSegments, directedGiftDays, emptyGiftDispatch, giftClaimFields, giftDispatchFingerprint, giftOfferView,
  giftMemberAllocations, giftSegmentView, giftShareView, publicGiftDays, transferGiftDays, type GiftDispatchState, type StoredGiftClaim,
} from './club-gift-allocation';
import type { ClaimGiftDispatchDto, ConfigureGiftDispatchDto, ReassignGiftDispatchDto } from './club-gift-dispatch.dto';
import { ClubOrder } from './club-order.schema';

import {
  acceptsGiftExecution, giftExecutionAccounts, giftExecutionSummary, giftUnlockReview,
  publishedGiftOrder, saveGiftDispatch, writableGiftDispatch as claimable,
} from './club-gift-execution.service';
const concurrentChange = () => new ConflictException('订单分工或履约正在更新，请重新加载后重试');
const retryClaim = () => new ServiceUnavailableException('订单分工或履约正在更新，请重试本次领取');

function eligibleOrder(order: ClubOrder) {
  if (order.dispatchPricing?.priceUnit !== 'gift_times' || order.receipt?.quote.priceUnit !== 'gift_times' ||
      order.receipt.receivedAmountCents !== order.receipt.quote.totalAmountCents)
    throw new ConflictException('仅已核款并正式派发的按次订单可以分工');
  return activeGiftSegments(order);
}

function matchReplay(saved: { fingerprint: string }, fingerprint: string) {
  if (saved.fingerprint !== fingerprint) throw new ConflictException('相同提交标识已用于不同的操作内容');
}

function publicRequestBySegment(claims: StoredGiftClaim[], userId: string) {
  const requested = new Map<number, number>();
  for (const claim of claims) {
    if (claim.userId !== userId) continue;
    const [segmentIndex, kind, , dailyGiftTimes] = giftClaimFields(claim);
    if (kind === 'public' && dailyGiftTimes !== null) {
      requested.set(segmentIndex, Math.max(requested.get(segmentIndex) ?? 0, dailyGiftTimes));
    }
  }
  return requested;
}

function claimReceipt(state: GiftDispatchState, saved: StoredGiftClaim): GiftClaimResult {
  const { requestedDailyGiftTimes, schedule } = saved.result;
  if (requestedDailyGiftTimes !== undefined && schedule !== undefined)
    return { ...saved.result, requestedDailyGiftTimes, schedule };
  const [segmentIndex, , offerId, dailyGiftTimes] = giftClaimFields(saved);
  const segment = state.segments.find(segment => segment.segmentIndex === segmentIndex);
  const offer = segment?.offers.find(offer => offer.id === offerId);
  const share = segment?.shares.find(share => share.id === saved.result.shareId);
  const historical = share && giftShareView(share, segment?.offers);
  return {
    ...saved.result,
    requestedDailyGiftTimes: dailyGiftTimes ?? offer?.dailyGiftTimes ?? saved.result.dailyGiftTimes,
    schedule: historical?.originalSchedule ?? historical?.schedule ?? [],
  };
}

function readOrder(order: ClubOrder, userId: string): GiftClaimOrder {
  const acceptingClaims = acceptsGiftExecution(order);
  const accountsByShare = new Map<string, ReturnType<typeof giftExecutionAccounts>>();
  const accounts = giftExecutionAccounts(order, userId);
  for (const account of accounts) {
    for (const shareId of account.shareIds) {
      const linked = accountsByShare.get(shareId) ?? [];
      linked.push(account);
      accountsByShare.set(shareId, linked);
    }
  }
  const authorizedSegments = (order.giftDispatch?.segments ?? []).filter(segment =>
    segment.shares.some(share => share.userId === userId) ||
    acceptingClaims && (segment.openToClaim || segment.offers.some(offer => offer.userId === userId)),
  );
  const quotes = activeGiftSegments(order);
  const requested = publicRequestBySegment(order.giftDispatch?.claims ?? [], userId);
  const segments = authorizedSegments.map(segment => {
    const view = giftSegmentView(segment, quotes[segment.segmentIndex], userId, acceptingClaims);
    return {
      ...view,
      shares: view.shares.map(share => ({ ...share, executionGameAccounts: accountsByShare.get(share.id) ?? [] })),
      myPublicRequestedDailyGiftTimes: requested.get(segment.segmentIndex) ?? 0,
    };
  });
  const hasOwnShare = segments.some(segment => segment.shares.length);
  const { estimatedReceivedHearts } = order.heartDelivery;
  const requestedGiftTimes = quotes.reduce((sum, quote) => sum + quote.paidGiftTimes, 0);
  const promotionalGiftTimes = quotes.reduce((sum, quote) => sum + (quote.promotionalGiftTimes ?? 0), 0);
  return {
    id: order._id.toHexString(), source: order.source, dispatcherUserId: order.dispatcherUserId!,
    requestedGiftTimes, ...(promotionalGiftTimes ? { promotionalGiftTimes } : {}),
    ...(estimatedReceivedHearts === undefined ? {} : { estimatedReceivedHearts }),
    ...(hasOwnShare ? { fulfillment: giftExecutionSummary(order, accounts) } : {}),
    ...(hasOwnShare || order.dispatcherUserId === userId
      ? { recipientGameAccount: order.recipientGameAccount } : {}),
    segments, acceptingClaims,
  };
}

function totalAllocation(
  total: GiftAllocationTotals, segment: GiftAllocationTotals,
): GiftAllocationTotals {
  return {
    paidGiftTimes: total.paidGiftTimes + segment.paidGiftTimes,
    ...((total.promotionalGiftTimes || segment.promotionalGiftTimes)
      ? { promotionalGiftTimes: (total.promotionalGiftTimes ?? 0) + (segment.promotionalGiftTimes ?? 0) } : {}),
    claimedGiftTimes: total.claimedGiftTimes + segment.claimedGiftTimes,
    directedPendingGiftTimes: total.directedPendingGiftTimes + segment.directedPendingGiftTimes,
    publicRemainingGiftTimes: total.publicRemainingGiftTimes + segment.publicRemainingGiftTimes,
    unconfiguredGiftTimes: total.unconfiguredGiftTimes + segment.unconfiguredGiftTimes,
    unallocatedGiftTimes: total.unallocatedGiftTimes + segment.unallocatedGiftTimes,
  };
}

@Injectable()
export class ClubGiftDispatchService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly dailyReports: ClubDailyReportStore,
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
    const order = await this.getOrder(orderId, { ...publishedGiftOrder, clubId, dispatcherUserId: userId });
    const quotes = eligibleOrder(order);
    const acceptingClaims = acceptsGiftExecution(order);
    await this.dailyReports.flushPendingReport(order);
    const [candidates, facts] = await Promise.all([
      this.candidates(clubId, userId),
      giftDayFacts(this.orders.db.collection('club_daily_reports'), order),
    ]);
    const sentByShare = new Map<string, bigint>();
    for (const row of eligiblePromotionalFacts(order, facts)) {
      const id = row._id.shareId.toHexString();
      sentByShare.set(id, (sentByShare.get(id) ?? 0n) + (row.eligibleGiftTimes ?? BigInt(row.giftTimes.toString())));
    }
    const segments = (order.giftDispatch?.segments ?? []).map(segment => {
      const view = giftSegmentView(segment, quotes[segment.segmentIndex], undefined, acceptingClaims);
      return {
        ...view,
        memberAllocations: giftMemberAllocations(segment.shares),
        shares: view.shares.map(share => {
          const sent = sentByShare.get(share.id) ?? 0n;
          return { ...share, deliveredGiftTimes: sent > BigInt(share.netGiftTimes) ? share.netGiftTimes : Number(sent) };
        }),
      };
    });
    const segmentsByIndex = new Map(segments.map(segment => [segment.segmentIndex, segment]));
    const segmentTotals = quotes.map((quote, segmentIndex) => {
      const { paidGiftTimes, promotionalGiftTimes } = quote;
      const capacity = giftSegmentTimes(quote);
      const segment = segmentsByIndex.get(segmentIndex);
      const window = order.continuationQuotes?.find(quote => quote.receipt && quote.segmentIndex === segmentIndex)?.window;
      const claimedGiftTimes = segment?.shares.reduce((sum, share) => sum + share.netGiftTimes, 0) ?? 0;
      const directedPendingGiftTimes = segment?.offers.reduce((sum, offer) => sum + (offer.accepted ? 0 : offer.giftTimes), 0) ?? 0;
      const publicRemainingGiftTimes = segment?.publicRemainingGiftTimes ?? 0;
      return {
        segmentIndex, configured: !!segment, paidGiftTimes, claimedGiftTimes, directedPendingGiftTimes, publicRemainingGiftTimes,
        ...(promotionalGiftTimes ? { promotionalGiftTimes } : {}),
        ...(window ? { window } : {}),
        unconfiguredGiftTimes: segment ? 0 : capacity,
        unallocatedGiftTimes: segment ? capacity - claimedGiftTimes - directedPendingGiftTimes - publicRemainingGiftTimes : 0,
      };
    });
    const totals = segmentTotals.reduce(totalAllocation, {
      paidGiftTimes: 0, claimedGiftTimes: 0, directedPendingGiftTimes: 0, publicRemainingGiftTimes: 0,
      unconfiguredGiftTimes: 0, unallocatedGiftTimes: 0,
    });
    return { quotes, segments, candidates, acceptingClaims, totals, segmentTotals, unlockReview: giftUnlockReview(order) };
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
      for (const segment of input.segments) {
        const window = order.continuationQuotes?.find(quote => quote.segmentIndex === segment.segmentIndex)?.window;
        if (window && (window.startDate !== segment.startDate || window.endDate !== segment.endDate))
          throw new BadRequestException('续段分工窗口须和已确认报价一致');
      }
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
      ...this.readScope(clubId, userId), ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
    }).sort({ _id: -1 }).limit(limit + 1).lean();
    return { items: orders.slice(0, limit).map(order => readOrder(order, userId)),
      nextCursor: orders.length > limit ? orders[limit - 1]._id.toHexString() : null };
  }

  async detail(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    return readOrder(await this.getOrder(orderId, this.readScope(clubId, userId)), userId);
  }

  async receipt(clubId: string, userId: string, orderId: string, requestId: string) {
    await this.directory.requireMember(clubId, userId);
    const scope = this.receiptScope(clubId, userId, requestId);
    const order = await this.getOrder(orderId, scope);
    const state = order.giftDispatch!;
    const saved = state.claims.find(item => item.requestId === requestId && item.userId === userId)!;
    return claimReceipt(state, saved);
  }

  async claim(clubId: string, userId: string, orderId: string, input: ClaimGiftDispatchDto) {
    await this.directory.requireMember(clubId, userId);
    const scope = this.claimScope(clubId, userId);
    const { requestId, segmentIndex, kind, dailyGiftTimes, actualReceivedHearts } = input;
    const offerId = input.offerId?.toLowerCase();
    if (kind === 'public' && offerId !== undefined || kind === 'directed' && dailyGiftTimes !== undefined)
      throw new BadRequestException('公开抢单填写日量，定向接单确认指定份额');
    const fingerprint = JSON.stringify([segmentIndex, kind, offerId, dailyGiftTimes, actualReceivedHearts]);
    const receiptScope = this.receiptScope(clubId, userId, requestId);
    for (let attempt = 0; attempt < 16; attempt++) {
      const order = await this.getOrder(orderId, { $or: [scope, receiptScope] });
      const state = order.giftDispatch!;
      const saved = state.claims.find(item => item.requestId === requestId && item.userId === userId);
      if (saved) {
        matchReplay(saved, fingerprint);
        return claimReceipt(state, saved);
      }
      if (order.pendingDailyReport) throw retryClaim();
      const quotes = eligibleOrder(order);
      const segment = state.segments.find(item => item.segmentIndex === segmentIndex);
      if (!segment) throw new NotFoundException('该段还没有分工');
      let days: ReturnType<typeof publicGiftDays>;
      let requestedDaily;
      let additionalDaily;
      if (kind === 'public') {
        if (!segment.openToClaim) throw new ForbiddenException('此段仅接受定向承接');
        const previousDaily = publicRequestBySegment(state.claims, userId).get(segmentIndex) ?? 0;
        requestedDaily = dailyGiftTimes!;
        if (requestedDaily <= previousDaily)
          throw new ConflictException('追加领取须提高本段已申报的总日量，请刷新后确认');
        const increase = requestedDaily - previousDaily;
        additionalDaily = previousDaily ? increase : undefined;
        days = publicGiftDays(segment, quotes[segmentIndex], increase);
      } else {
        const offer = segment.offers.find(item => item.id === offerId && item.userId === userId);
        if (!offer) throw new ForbiddenException('本段没有此项指定给你的份额');
        if (offer.accepted) throw new ConflictException('你已确认承接此份额');
        requestedDaily = offer.dailyGiftTimes;
        days = directedGiftDays(offer);
      }
      const result = awardGiftShare(segment, kind, userId, days, requestedDaily, actualReceivedHearts, additionalDaily);
      state.claims.push({ requestId, userId, fingerprint, result });
      if (await this.save(order, scope, state)) return result;
    }
    const finalOrder = await this.findOrder(orderId, receiptScope);
    const state = finalOrder?.giftDispatch;
    const saved = state?.claims.find(item => item.requestId === requestId && item.userId === userId);
    if (state && saved) {
      matchReplay(saved, fingerprint);
      return claimReceipt(state, saved);
    }
    throw retryClaim();
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
      if (order.pendingDailyReport) {
        await this.dailyReports.flushPendingReport(order);
        continue;
      }
      await this.directory.requireAssignmentCandidate(clubId, input.userId);
      const sent = await this.sentGiftTimes(order, share.id, share.userId);
      const offer = transferGiftDays(share, sent, input.userId, input.giftTimes);
      const result = giftOfferView(offer);
      segment.offers.push(offer);
      state.transfers.push({ requestId: input.requestId, fingerprint, result });
      if (await this.save(order, scope, state)) return result;
    }
    throw concurrentChange();
  }

  private readScope(clubId: string, userId: string): QueryFilter<ClubOrder> {
    return { $or: [this.claimScope(clubId, userId), {
      ...publishedGiftOrder, clubId, 'giftDispatch.executionAccounts.userId': userId,
    }] };
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

  private receiptScope(clubId: string, userId: string, requestId: string): QueryFilter<ClubOrder> {
    return { clubId, 'giftDispatch.claims': { $elemMatch: { userId, requestId } } };
  }

  private async getOrder(id: string, scope: QueryFilter<ClubOrder>) {
    const order = await this.findOrder(id, scope);
    if (!order) throw new NotFoundException('当前没有可操作的已派发按次订单');
    return order;
  }

  private findOrder(id: string, scope: QueryFilter<ClubOrder>) {
    if (!isObjectIdOrHexString(id)) throw new BadRequestException('订单标识格式无效');
    return this.orders.findOne({ ...scope, _id: id }).lean();
  }

  private async requireCandidates(clubId: string, input: GiftSegmentDispatchInput[]) {
    const ids = [...new Set(input.flatMap(segment => segment.directed.map(item => item.userId)))];
    await Promise.all(ids.map(id => this.directory.requireAssignmentCandidate(clubId, id)));
  }

  private save(order: ClubOrder, scope: QueryFilter<ClubOrder>, state: GiftDispatchState) {
    return saveGiftDispatch(this.orders, order, scope, state);
  }

  private async sentGiftTimes(order: ClubOrder, shareId: string, userId: string) {
    const rows = await giftDayFacts(this.orders.db.collection('club_daily_reports'), order, new Types.ObjectId(shareId), userId);
    const counts = rows.map(row => [row._id.businessDate, Number(row.giftTimes.toString())] as const);
    const total = counts.reduce((sum, [, times]) => sum + times, 0);
    if (!Number.isSafeInteger(total) || counts.some(([, times]) => !Number.isSafeInteger(times) || times < 0))
      throw new ConflictException('该份额已送次数需要核对');
    return new Map(counts);
  }
}
