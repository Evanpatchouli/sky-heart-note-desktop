import { BadRequestException, ConflictException } from '@nestjs/common';
import type {
  GiftClaimResult, GiftDayAllocation, GiftDispatchSegment, GiftOffer, GiftPriceSegment, GiftSegmentDispatchInput, GiftShare, GiftWindow,
} from '@webapp-template/common';
import { Types } from 'mongoose';

const dayMilliseconds = 86_400_000;
const maximumWindowDays = 3660;

type DayAmounts = Map<number, number>;
type GiftDayRun = GiftDayAllocation;
export type StoredGiftOffer = Omit<GiftOffer, 'schedule'> & { days: GiftDayRun[] };
export type StoredGiftShare = Omit<GiftShare, 'schedule'> & { days: GiftDayRun[] };
export type StoredGiftSegment = GiftWindow & {
  segmentIndex: number;
  openToClaim: boolean;
  offers: StoredGiftOffer[];
  shares: StoredGiftShare[];
};
export type GiftDispatchState = {
  segments: StoredGiftSegment[];
  configurations: { requestId: string; fingerprint: string }[];
  claims: { requestId: string; userId: string; fingerprint: string; result: GiftClaimResult }[];
  transfers: { requestId: string; fingerprint: string; result: GiftOffer }[];
};

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
  return { free, remaining: quote.paidGiftTimes - total(reserved) };
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
    if (!quote) throw new BadRequestException('请选择已付计价段');
    const segment: StoredGiftSegment = { segmentIndex, openToClaim, startDate, endDate, offers: [], shares: [] };
    const window = dayRange(segment);
    if (Math.ceil(quote.paidGiftTimes / quote.dailyGiftTimes) > window.end - window.start + 1)
      throw new BadRequestException('执行窗口不足以完成此段付费赠送次数');
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

export function giftShareView({ days, ...share }: StoredGiftShare): GiftShare {
  return { ...share, schedule: days };
}

export function giftSegmentView(segment: StoredGiftSegment, quote: GiftPriceSegment, userId?: string): GiftDispatchSegment {
  const { free, remaining } = inventory(segment, quote);
  const publicDays = take(free, Number.MAX_SAFE_INTEGER, remaining);
  const ownShares = segment.shares.filter(share => share.userId === userId);
  const publicAvailable = segment.openToClaim && remaining > 0 && free.size > 0 &&
    !ownShares.some(share => share.kind === 'public');
  return {
    segmentIndex: segment.segmentIndex, startDate: segment.startDate, endDate: segment.endDate,
    openToClaim: segment.openToClaim,
    publicDailyGiftTimes: publicAvailable ? Math.max(...publicDays.values()) : 0,
    publicRemainingGiftTimes: publicAvailable ? total(publicDays) : 0,
    publicSchedule: publicAvailable ? compress(publicDays) : [],
    offers: segment.offers.filter(offer => userId === undefined || offer.userId === userId).map(giftOfferView),
    shares: (userId === undefined ? segment.shares : ownShares).map(giftShareView),
  };
}

export function publicGiftDays(segment: StoredGiftSegment, quote: GiftPriceSegment, requestedDaily: number) {
  const { free, remaining } = inventory(segment, quote);
  return take(take(free, Number.MAX_SAFE_INTEGER, remaining), requestedDaily, remaining);
}

export function awardGiftShare(
  segment: StoredGiftSegment, kind: 'public' | 'directed', userId: string,
  amounts: DayAmounts, actualReceivedHearts?: number,
): GiftClaimResult {
  const days = compress(amounts);
  if (!days.length) return { dailyGiftTimes: 0, giftTimes: 0 };
  const share: StoredGiftShare = {
    id: new Types.ObjectId().toHexString(), kind, userId, days,
    startDate: days[0].startDate, endDate: days.at(-1)!.endDate,
    dailyGiftTimes: Math.max(...days.map(day => day.dailyGiftTimes)), giftTimes: total(amounts),
    ...(actualReceivedHearts === undefined ? {} : { actualReceivedHearts }),
  };
  segment.shares.push(share);
  const { dailyGiftTimes, giftTimes } = share;
  return { shareId: share.id, dailyGiftTimes, giftTimes, ...(actualReceivedHearts === undefined ? {} : { actualReceivedHearts }) };
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
