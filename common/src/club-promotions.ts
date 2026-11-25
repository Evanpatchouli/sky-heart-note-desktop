import { formatCentsAsYuan, type GiftPriceSegment } from './club-pricing';

export const MAX_PROMOTIONAL_GIFT_DIVISOR = 10;

export const platformPromotionKinds = ['activity', 'rate_coupon', 'threshold_coupon'] as const;
export type PlatformPromotionKind = (typeof platformPromotionKinds)[number];

export const platformPromotionLabels = {
  activity: '全场折扣活动',
  rate_coupon: '折扣券',
  threshold_coupon: '满减优惠券',
} satisfies Record<PlatformPromotionKind, string>;

export type PlatformPromotionTerms =
  | { kind: 'activity' | 'rate_coupon'; payableBasisPoints: number }
  | { kind: 'threshold_coupon'; thresholdCents: number; discountCents: number };

export type PlatformPromotionSource = PlatformPromotionTerms & {
  clubId: string;
  id: string;
  version: number;
  name: string;
  couponId?: string;
};

export interface ClubPromotionPolicy {
  version: number;
  activity: ({ name: string; payableBasisPoints: number }) | null;
}

export interface PromotionalGiftSegment {
  sourceSegmentIndex: number;
  promotionalGiftTimes: number;
  dailyGiftTimes: number;
}

export interface QuoteDiscountShare {
  paidGiftTimes: number;
  unitPriceCents: number;
  platformDiscountCents: number;
  personalDiscountCents: number;
}

export interface GiftQuotePromotions {
  originalServiceCents: number;
  platform?: PlatformPromotionSource & { amountCents: number };
  personal?: { dispatcherUserId: string; amountCents: number };
  segmentDiscounts: QuoteDiscountShare[];
  gift?: { clubId: string; dispatcherUserId: string; segments: PromotionalGiftSegment[] };
  totalGiftTimes: number;
  selectedCouponId?: string | null;
  couponIssue?: 'unavailable' | 'threshold';
}

export function platformPromotionDescription(source: PlatformPromotionSource) {
  if (source.kind === 'threshold_coupon') {
    return `${source.name}（满 ¥${formatCentsAsYuan(source.thresholdCents)} 减 ¥${formatCentsAsYuan(source.discountCents)}）`;
  }
  return `${source.name}（服务款实付 ${source.payableBasisPoints / 100}%）`;
}

export function giftSegmentTimes(segment: GiftPriceSegment) {
  return segment.paidGiftTimes + (segment.promotionalGiftTimes ?? 0);
}

export function giftFulfillmentSegments(
  paid: readonly GiftPriceSegment[], promotions?: GiftQuotePromotions,
): GiftPriceSegment[] {
  return [...paid, ...(promotions?.gift?.segments ?? []).map(gift => {
    const source = paid[gift.sourceSegmentIndex];
    return {
      period: source.period, unitPriceCents: source.unitPriceCents, paidGiftTimes: 0,
      promotionalGiftTimes: gift.promotionalGiftTimes, dailyGiftTimes: gift.dailyGiftTimes,
    };
  })];
}

function splitByService(amount: number, weights: number[], total: number, limits = weights) {
  const denominator = BigInt(total);
  const portions = weights.map((weight, index) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return { index, amount: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = amount - portions.reduce((sum, portion) => sum + portion.amount, 0);
  const ranked = [...portions].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const portion of ranked) {
    if (!remaining) break;
    if (portion.amount >= limits[portion.index]) continue;
    portion.amount++;
    remaining--;
  }
  if (remaining) {
    for (const portion of ranked) {
      if (!remaining) break;
      const extra = Math.min(remaining, limits[portion.index] - portion.amount);
      portion.amount += extra;
      remaining -= extra;
    }
  }
  return portions.map(portion => portion.amount);
}

export function platformDiscountForService(source: PlatformPromotionTerms, amountCents: number) {
  if (source.kind === 'threshold_coupon') {
    return amountCents < source.thresholdCents ? null : source.discountCents;
  }
  // Round the discounted service price to the nearest cent, with half cents rounded up.
  return amountCents - Number((BigInt(amountCents) * BigInt(source.payableBasisPoints) + 5_000n) / 10_000n);
}

export function splitGiftQuoteDiscounts(
  segments: readonly GiftPriceSegment[], platformCents: number, personalCents: number,
): QuoteDiscountShare[] {
  const weights = segments.map(segment => segment.paidGiftTimes * segment.unitPriceCents);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const platform = splitByService(platformCents, weights, total);
  const personal = splitByService(personalCents, weights, total, weights.map((weight, index) => weight - platform[index]));
  return segments.map(({ paidGiftTimes, unitPriceCents }, index) => ({
    paidGiftTimes, unitPriceCents, platformDiscountCents: platform[index], personalDiscountCents: personal[index],
  }));
}

// In each segment the platform's extra cents occupy the first indices and the
// dispatcher's extra cents occupy the last. This keeps every unit nonnegative.
export function giftServiceAmounts(share: QuoteDiscountShare, from: number, through: number) {
  const { paidGiftTimes, unitPriceCents, platformDiscountCents, personalDiscountCents } = share;
  const count = through - from;
  const quotient = (amount: number) => Number(BigInt(amount) / BigInt(paidGiftTimes));
  const platformExtra = platformDiscountCents % paidGiftTimes;
  const personalExtraStart = paidGiftTimes - personalDiscountCents % paidGiftTimes;
  const platform = count * quotient(platformDiscountCents) + Math.min(through, platformExtra) - Math.min(from, platformExtra);
  const personal = count * quotient(personalDiscountCents) + Math.max(0, through - Math.max(from, personalExtraStart));
  const original = count * unitPriceCents;
  return { originalCents: original, platformDiscountCents: platform, personalDiscountCents: personal, serviceCents: original - platform - personal };
}
