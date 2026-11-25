import { BadRequestException, ConflictException } from '@nestjs/common';
import { giftFulfillmentSegments, giftSegmentTimes } from '@webapp-template/common';
import type {
  GiftClaimResult, GiftDayAllocation, GiftExecutionAccount, GiftDispatchSegment, GiftOffer, GiftPriceSegment, GiftSegmentDispatchInput, GiftShare, GiftWindow,
} from '@webapp-template/common';
import { Types } from 'mongoose';
import type { ClubOrder } from './club-order.schema';

const dayMilliseconds = 86_400_000;
const maximumWindowDays = 3660;

type DayAmounts = Map<number, number>;
type GiftDayRun = GiftDayAllocation;
export type StoredGiftOffer = Omit<GiftOffer, 'schedule'> & { days: GiftDayRun[] };
export type StoredGiftShare = Omit<GiftShare, 'schedule' | 'netGiftTimes' | 'originalSchedule' | 'executionGameAccounts'> & { days: GiftDayRun[] };
export type StoredGiftSegment = GiftWindow & {
  segmentIndex: number;
  openToClaim: boolean;
  offers: StoredGiftOffer[];
  shares: StoredGiftShare[];
};
export type StoredGiftExecutionAccount = Omit<GiftExecutionAccount, 'linkedAt' | 'relationship'> & {
  customerUserId: string | null;
  customerNickname: string | null;
  linkedAt: Date;
  relationship: (Omit<NonNullable<GiftExecutionAccount['relationship']>, 'occurredAt' | 'recordedAt'> & {
    occurredAt: Date;
    recordedAt: Date;
  }) | null;
};

export type GiftDispatchState = {
  executionAccounts?: StoredGiftExecutionAccount[];
  segments: StoredGiftSegment[];
  configurations: { requestId: string; fingerprint: string }[];
  claims: StoredGiftClaim[];
  transfers: { requestId: string; fingerprint: string; result: GiftOffer }[];
};

export type StoredGiftClaim = {
  requestId: string;
  userId: string;
  fingerprint: string;
  result: Omit<GiftClaimResult, 'requestedDailyGiftTimes' | 'schedule'>
    & Partial<Pick<GiftClaimResult, 'requestedDailyGiftTimes' | 'schedule'>>;
};

export function giftClaimFields(claim: StoredGiftClaim) {
  // This is the unchanged fingerprint format used by the original published receipts.
  return JSON.parse(claim.fingerprint) as [number, 'public' | 'directed', string | null, number | null, number | null];
}

function dateAt(day: number) {
  return new Date(day * dayMilliseconds).toISOString().slice(0, 10);
}

function dayOf(date: string) {
  const value = Date.parse(date + 'T00:00:00.000Z') / dayMilliseconds;
  if (!Number.isInteger(value) || dateAt(value) !== date)
    throw new BadRequestException('请输入有效的执行日期');
  return value;
}

function dayRange({ startDate, endDate }: GiftWindow) {
  const start = dayOf(startDate);
  const end = dayOf(endDate);
  if (end < start || end - start >= maximumWindowDays)
    throw new BadRequestException('执行窗口需按先后填写，最多 3660 天');
  return { start, end };
}

export function requireGiftWindowCapacity(window: GiftWindow, times: number, daily: number) {
  const { start, end } = dayRange(window);
  if (Math.ceil(times / daily) > end - start + 1)
    throw new BadRequestException('执行窗口不足以完成此段赠送次数');
}

export function activeGiftSegments(order: ClubOrder): GiftPriceSegment[] {
  const initial = giftFulfillmentSegments(order.dispatchPricing?.giftSegments ?? [], order.dispatchPricing?.promotions);
  const active = (order.continuationQuotes ?? [])
    .filter(quote => quote.receipt && quote.segmentIndex !== undefined)
    .sort((a, b) => a.segmentIndex! - b.segmentIndex!);
  return [...initial, ...active.map(quote => quote.segment)];
}

export function giftSchedule(days: GiftDayAllocation[]) {
  const amounts: DayAmounts = new Map();
  addDays(amounts, days);
  return new Map([...amounts].map(([day, count]) => [dateAt(day), count]));
}

function addDays(amounts: DayAmounts, days: GiftDayRun[]) {
  for (const run of days) {
    const { start, end } = dayRange(run);
    for (let day = start; day <= end; day++)
      amounts.set(day, (amounts.get(day) ?? 0) + run.dailyGiftTimes);
  }
}

function total(amounts: DayAmounts) {
  return [...amounts.values()].reduce((sum, count) => sum + count, 0);
}

function compress(amounts: DayAmounts): GiftDayRun[] {
  const runs: GiftDayRun[] = [];
  let previousDay: number | undefined;
  for (const [day, dailyGiftTimes] of [...amounts].sort(([a], [b]) => a - b)) {
    if (!dailyGiftTimes) continue;
    const previous = runs.at(-1);
    if (previous && day === previousDay! + 1 && previous.dailyGiftTimes === dailyGiftTimes)
      previous.endDate = dateAt(day);
    else runs.push({ startDate: dateAt(day), endDate: dateAt(day), dailyGiftTimes });
    previousDay = day;
  }
  return runs;
}

function inventory(segment: StoredGiftSegment, quote: GiftPriceSegment) {
  const reserved = new Map<number, number>();
  for (const item of [...segment.offers.filter(offer => !offer.accepted), ...segment.shares])
    addDays(reserved, item.days);
  const { start, end } = dayRange(segment);
  const free = new Map<number, number>();
  for (let day = start; day <= end; day++) {
    const available = quote.dailyGiftTimes - (reserved.get(day) ?? 0);
    if (available > 0) free.set(day, available);
  }
  return { free, remaining: giftSegmentTimes(quote) - total(reserved) };
}

function take(free: DayAmounts, perDay: number, limit: number) {
  const selected = new Map<number, number>();
  for (const [day, available] of free) {
    if (limit <= 0) break;
    const count = Math.min(available, perDay, limit);
    selected.set(day, count);
    limit -= count;
  }
  return selected;
}

export function emptyGiftDispatch(): GiftDispatchState {
  return { segments: [], configurations: [], claims: [], transfers: [] };
}

export function giftDispatchFingerprint(input: readonly GiftSegmentDispatchInput[]) {
  return JSON.stringify(input.map(({ segmentIndex, startDate, endDate, openToClaim, directed }) => [
    segmentIndex, startDate, endDate, openToClaim,
    directed.map(({ userId, dailyGiftTimes, startDate, endDate }) => [userId, dailyGiftTimes, startDate, endDate]),
  ]));
}

export function buildGiftSegments(
  input: readonly GiftSegmentDispatchInput[],
  quotes: readonly GiftPriceSegment[],
): StoredGiftSegment[] {
  if (!input.length || new Set(input.map(segment => segment.segmentIndex)).size !== input.length)
    throw new BadRequestException('请为至少一个已付计价段配置一次派发');
  return input.map(({ segmentIndex, openToClaim, startDate, endDate, directed }) => {
    const quote = quotes[segmentIndex];
    if (!quote) throw new BadRequestException('请选择已核款的履约段');
    const segment: StoredGiftSegment = { segmentIndex, openToClaim, startDate, endDate, offers: [], shares: [] };
    const window = dayRange(segment);
    requireGiftWindowCapacity(segment, giftSegmentTimes(quote), quote.dailyGiftTimes);
    if (!openToClaim && !directed.length)
      throw new BadRequestException('请选择开放抢单或填写至少一名指定团员');
    if (new Set(directed.map(item => item.userId)).size !== directed.length)
      throw new BadRequestException('同一段的每名团员只能指定一次初始份额');
    for (const assignment of directed) {
      const { start, end } = dayRange(assignment);
      if (start < window.start || end > window.end)
        throw new BadRequestException('指定团员的执行窗口须在本段窗口内');
      const { free, remaining } = inventory(segment, quote);
      const days = new Map<number, number>();
      let availableTimes = remaining;
      for (let day = start; day <= end && availableTimes > 0; day++) {
        const count = Math.min(assignment.dailyGiftTimes, availableTimes);
        if ((free.get(day) ?? 0) < count)
          throw new BadRequestException('同一日的指定次数超出该段日量');
        days.set(day, count);
        availableTimes -= count;
      }
      if (!days.size || days.size !== end - start + 1)
        throw new BadRequestException('指定执行窗口超出段内可分配次数');
      segment.offers.push({
        ...assignment, id: new Types.ObjectId().toHexString(), giftTimes: total(days),
        days: compress(days), accepted: false,
      });
    }
    if (!openToClaim && inventory(segment, quote).remaining !== 0)
      throw new BadRequestException('仅定向承接须分完本段赠送次数，也可开放剩余次数供团员抢单');
    return segment;
  });
}

export function giftOfferView({ days: _days, ...offer }: StoredGiftOffer): GiftOffer {
  return { ...offer, schedule: _days };
}

export function giftShareView({ days, ...share }: StoredGiftShare, offers: StoredGiftOffer[] = []): GiftShare {
  const outgoing = offers.filter(offer => offer.transferredFromShareId === share.id);
  const original = new Map<number, number>();
  if (outgoing.length) {
    addDays(original, days);
    for (const offer of outgoing) addDays(original, offer.days);
  }
  return {
    ...share,
    schedule: days,
    netGiftTimes: share.giftTimes - (share.transferredGiftTimes ?? 0),
    ...(outgoing.length ? { originalSchedule: compress(original) } : {}),
  };
}

export function giftSegmentView(
  segment: StoredGiftSegment, quote: GiftPriceSegment, userId?: string, acceptingClaims = true,
): GiftDispatchSegment {
  const { free, remaining } = inventory(segment, quote);
  const publicDays = segment.openToClaim && acceptingClaims ? take(free, Number.MAX_SAFE_INTEGER, remaining) : new Map<number, number>();
  const ownShares = segment.shares.filter(share => share.userId === userId);
  return {
    segmentIndex: segment.segmentIndex, startDate: segment.startDate, endDate: segment.endDate,
    ...(quote.promotionalGiftTimes ? { promotionalGiftTimes: quote.promotionalGiftTimes } : {}),
    openToClaim: segment.openToClaim,
    publicDailyGiftTimes: publicDays.size ? Math.max(...publicDays.values()) : 0,
    publicRemainingGiftTimes: total(publicDays),
    publicSchedule: compress(publicDays),
    offers: segment.offers.filter(offer => userId === undefined || offer.userId === userId).map(giftOfferView),
    shares: (userId === undefined ? segment.shares : ownShares).map(share => giftShareView(share, segment.offers)),
  };
}

export function giftMemberAllocations(shares: StoredGiftShare[]) {
  const byMember = new Map<string, DayAmounts>();
  for (const share of shares) {
    const days = byMember.get(share.userId) ?? new Map<number, number>();
    addDays(days, share.days);
    byMember.set(share.userId, days);
  }
  return [...byMember].map(([userId, days]) => ({ userId, giftTimes: total(days), schedule: compress(days) }));
}

export function publicGiftDays(segment: StoredGiftSegment, quote: GiftPriceSegment, requestedDaily: number) {
  const { free, remaining } = inventory(segment, quote);
  return take(take(free, Number.MAX_SAFE_INTEGER, remaining), requestedDaily, remaining);
}

export function awardGiftShare(
  segment: StoredGiftSegment, kind: 'public' | 'directed', userId: string,
  amounts: DayAmounts, requestedDailyGiftTimes: number, actualReceivedHearts?: number,
  additionalRequestedDailyGiftTimes?: number,
): GiftClaimResult {
  const schedule = compress(amounts);
  const request = {
    requestedDailyGiftTimes, schedule,
    ...(additionalRequestedDailyGiftTimes === undefined ? {} : { additionalRequestedDailyGiftTimes }),
  };
  if (!schedule.length) return { ...request, dailyGiftTimes: 0, giftTimes: 0 };
  const share: StoredGiftShare = {
    id: new Types.ObjectId().toHexString(), kind, userId, days: schedule,
    startDate: schedule[0].startDate, endDate: schedule.at(-1)!.endDate,
    dailyGiftTimes: Math.max(...schedule.map(day => day.dailyGiftTimes)), giftTimes: total(amounts),
    ...(actualReceivedHearts === undefined ? {} : { actualReceivedHearts }),
  };
  segment.shares.push(share);
  const { dailyGiftTimes, giftTimes } = share;
  return { ...request, shareId: share.id, dailyGiftTimes, giftTimes, ...(actualReceivedHearts === undefined ? {} : { actualReceivedHearts }) };
}

export function directedGiftDays(offer: StoredGiftOffer) {
  const days = new Map<number, number>();
  addDays(days, offer.days);
  offer.accepted = true;
  return days;
}

export function transferGiftDays(
  share: StoredGiftShare, sent: ReadonlyMap<string, number>, userId: string, count?: number,
): StoredGiftOffer {
  const current = new Map<number, number>();
  addDays(current, share.days);
  const unfulfilled = new Map(current);
  let unassignedSent = 0;
  for (const [date, times] of sent) {
    const day = dayOf(date);
    const onDate = Math.min(current.get(day) ?? 0, times);
    if (onDate > 0) unfulfilled.set(day, current.get(day)! - onDate);
    unassignedSent += times - onDate;
  }
  for (const [day, amount] of take(unfulfilled, Number.MAX_SAFE_INTEGER, unassignedSent)) {
    unfulfilled.set(day, unfulfilled.get(day)! - amount);
  }
  const outstanding = total(current) - [...sent.values()].reduce((sum, times) => sum + times, 0);
  const giftTimes = count ?? outstanding;
  if (giftTimes <= 0 || giftTimes > outstanding)
    throw new ConflictException('可改派次数已变化，仅能改派未送次数');
  if (total(unfulfilled) < giftTimes) throw new ConflictException('已送次数需要核对');
  const moved = take(new Map([...unfulfilled].reverse()), Number.MAX_SAFE_INTEGER, giftTimes);
  for (const [day, amount] of moved) current.set(day, current.get(day)! - amount);
  const days = compress(moved);
  share.days = compress(current);
  share.transferredGiftTimes = (share.transferredGiftTimes ?? 0) + giftTimes;
  return {
    id: new Types.ObjectId().toHexString(), userId, days, giftTimes,
    startDate: days[0].startDate, endDate: days.at(-1)!.endDate,
    dailyGiftTimes: Math.max(...days.map(day => day.dailyGiftTimes)),
    transferredFromShareId: share.id, accepted: false,
  };
}
