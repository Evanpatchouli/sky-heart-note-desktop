export const COMMISSION_BASES = ['received_hearts', 'gift_times'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const PRICING_PERIODS = ['normal', 'double'] as const;
export type PricingPeriod = (typeof PRICING_PERIODS)[number];

export const DELIVERY_PERIOD_PREFERENCES = [...PRICING_PERIODS, 'split'] as const;
export type DeliveryPeriodPreference = (typeof DELIVERY_PERIOD_PREFERENCES)[number];

export const deliveryPeriodPreferenceLabel = {
  normal: '普通期',
  double: '双倍期',
  split: '普通期与双倍期分段',
} satisfies Record<DeliveryPeriodPreference, string>;

export function estimateReceivedHearts(
  giftTimes: number,
  period?: DeliveryPeriodPreference,
  doubleGiftTimes?: number,
) {
  if (!Number.isSafeInteger(giftTimes) || giftTimes < 1) return undefined;
  if (period === 'normal') return giftTimes;
  const doubleTimes = period === 'double' ? giftTimes : doubleGiftTimes;
  if (doubleTimes === undefined || !Number.isSafeInteger(doubleTimes) || doubleTimes < 1) return undefined;
  if (period !== 'double' && (period !== 'split' || doubleTimes >= giftTimes)) return undefined;
  const estimate = giftTimes + doubleTimes;
  return Number.isSafeInteger(estimate) ? estimate : undefined;
}

export interface GiftPriceSegment {
  period: PricingPeriod;
  paidGiftTimes: number;
  dailyGiftTimes: number;
  unitPriceCents: number;
}

export interface ContinuationQuote {
  requestId: string;
  segment: GiftPriceSegment;
  amountCents: number;
}

export function calculateGiftQuote(segments: readonly GiftPriceSegment[]) {
  let paidGiftTimes = 0;
  let amountCents = 0;
  for (const segment of segments) {
    const { paidGiftTimes: times, dailyGiftTimes, unitPriceCents } = segment;
    if (
      !Number.isSafeInteger(times) || times < 1 ||
      !Number.isSafeInteger(dailyGiftTimes) || dailyGiftTimes < 1 || dailyGiftTimes > times ||
      !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1
    ) return null;
    paidGiftTimes += times;
    amountCents += times * unitPriceCents;
    if (!Number.isSafeInteger(paidGiftTimes) || !Number.isSafeInteger(amountCents)) return null;
  }
  return segments.length ? { paidGiftTimes, amountCents } : null;
}

export interface GiftOrderPricing {
  priceUnit?: 'gift_times';
  giftSegments?: GiftPriceSegment[];
}

export interface CommissionRule {
  version: number;
  basis: CommissionBasis;
  clubFeeCents: number;
}

export interface PriceSegment {
  period: PricingPeriod;
  hearts: number;
  giftHearts?: number;
  unitPriceCents: number;
}

export interface UnlockPricing {
  quantity: number;
  unitPriceCents: number;
  unitPriceAgreed?: boolean;
}

export interface CustomerQuote extends GiftOrderPricing {
  revision: number;
  segments: PriceSegment[];
  unlock: UnlockPricing;
  originalHeartsAmountCents?: number;
  heartsAmountCents: number;
  unlockAmountCents: number;
  totalAmountCents: number;
}

export function calculateQuoteAmounts(
  segments: readonly PriceSegment[],
  unlock: UnlockPricing,
  discountedHeartsAmountCents?: number,
) {
  if (!segments.length) return null;
  let originalHeartsAmountCents = 0;
  for (const { hearts, giftHearts = 0, unitPriceCents } of segments) {
    if (
      !Number.isSafeInteger(hearts) || hearts < 0 ||
      !Number.isSafeInteger(giftHearts) || giftHearts < 0 || (hearts === 0 && giftHearts === 0) ||
      !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1
    ) return null;
    originalHeartsAmountCents += hearts * unitPriceCents;
    if (!Number.isSafeInteger(originalHeartsAmountCents)) return null;
  }
  if (
    !Number.isSafeInteger(unlock.quantity) || unlock.quantity < 0 ||
    !Number.isSafeInteger(unlock.unitPriceCents) || unlock.unitPriceCents < 0 ||
    (discountedHeartsAmountCents !== undefined && (
      !Number.isSafeInteger(discountedHeartsAmountCents) || discountedHeartsAmountCents < 0 ||
      discountedHeartsAmountCents >= originalHeartsAmountCents
    ))
  ) return null;
  const heartsAmountCents = discountedHeartsAmountCents ?? originalHeartsAmountCents;
  const unlockAmountCents = unlock.quantity * unlock.unitPriceCents;
  const totalAmountCents = heartsAmountCents + unlockAmountCents;
  if (!Number.isSafeInteger(totalAmountCents)) return null;
  return {
    heartsAmountCents,
    unlockAmountCents,
    totalAmountCents,
    ...(discountedHeartsAmountCents === undefined ? {} : { originalHeartsAmountCents }),
  };
}

export interface OrderPricing extends GiftOrderPricing {
  ruleVersion?: number;
  basis: CommissionBasis;
  dispatchFeeCents: number;
  segments: PriceSegment[];
  unlock?: UnlockPricing;
  discountedHeartsAmountCents?: number;
  revision: number;
}

export interface DispatchPricing extends CommissionRule, OrderPricing {}

export const commissionBasisLabel = {
  received_hearts: '到账颗数',
  gift_times: '赠送次数',
} satisfies Record<CommissionBasis, string>;

export function commissionUnit(basis: CommissionBasis) {
  return basis === 'gift_times' ? '次' : '颗';
}

export function parseYuanAsCents(raw: string | null | undefined) {
  if (raw == null || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [yuan, decimal = ''] = raw.split('.');
  const cents = Number(yuan + decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCentsAsYuan(cents: number) {
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
