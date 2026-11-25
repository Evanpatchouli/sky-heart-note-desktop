export const COMMISSION_BASES = ['received_hearts', 'gift_times'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const PRICING_PERIODS = ['normal', 'double'] as const;
export type PricingPeriod = (typeof PRICING_PERIODS)[number];

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
  unitPriceCents: number;
}

export interface UnlockPricing {
  quantity: number;
  unitPriceCents: number;
}

export interface OrderPricing extends GiftOrderPricing {
  ruleVersion?: number;
  basis: CommissionBasis;
  dispatchFeeCents: number;
  segments: PriceSegment[];
  unlock?: UnlockPricing;
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
