import type { GiftWindow } from './club-gift-dispatch';
import type { GiftQuotePromotions } from './club-promotions';

export const COMMISSION_BASES = ['received_hearts', 'gift_times'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];

export const PRICING_PERIODS = ['normal', 'double'] as const;
export type PricingPeriod = (typeof PRICING_PERIODS)[number];

export interface GiftPriceSegment {
  period: PricingPeriod;
  paidGiftTimes: number;
  promotionalGiftTimes?: number;
  dailyGiftTimes: number;
  unitPriceCents: number;
}

export interface ContinuationQuote {
  requestId: string;
  segment: GiftPriceSegment;
  amountCents: number;
  customerRequestId?: string;
  window?: GiftWindow;
  acceptance?: { requestId: string; acceptedAt: string };
  receipt?: { receivedAmountCents: number; receivedAt: string };
  segmentIndex?: number;
}

export interface ContinuationRequest extends GiftWindow {
  requestId: string;
  period: PricingPeriod;
  paidGiftTimes: number;
  dailyGiftTimes: number;
  requestedAt: string;
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
  promotions?: GiftQuotePromotions;
}

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

export interface CommissionRule {
  version: number;
  basis: CommissionBasis;
  clubFeeCents: number;
}

export interface PriceSegment {
  period: PricingPeriod;
  /** Paid hearts in this segment. */
  hearts: number;
  giftHearts?: number;
  unitPriceCents: number;
}

export interface QuoteAmounts {
  heartsAmountCents: number;
  originalHeartsAmountCents?: number;
  totalAmountCents: number;
}

export interface CustomerQuote extends QuoteAmounts, GiftOrderPricing {
  revision: number;
  segments: PriceSegment[];
}

export interface OrderPricing extends GiftOrderPricing {
  ruleVersion?: number;
  basis: CommissionBasis;
  dispatchFeeCents: number;
  segments: PriceSegment[];
  discountedHeartsAmountCents?: number;
  revision: number;
}

export interface PendingQuoteActivity {
  reason: 'stacking_pending';
  proposedDiscountedHeartsAmountCents: number;
}

export interface DispatchPricing extends CommissionRule, OrderPricing {}

export interface CommissionReview {
  revision: number;
  ruleVersion: number;
  basis: CommissionBasis;
  dispatchFeeCents: number;
}

export interface CustomerReceipt {
  receivedAmountCents: number;
  receivedAt: string;
}

export interface OrderReceipt extends CustomerReceipt {
  requestId: string;
  recordedByUserId: string;
  receivedByUserId: string;
  recordedAt: string;
  quote: CustomerQuote;
}

export type PaymentStatus = 'not_registered' | 'underpaid' | 'paid_in_full' | 'overpaid';

export const paymentStatusLabel = {
  not_registered: '未登记实收',
  underpaid: '实收少于报价，差额待核对',
  paid_in_full: '已登记足额实收',
  overpaid: '实收多于报价，差额待核对',
} satisfies Record<PaymentStatus, string>;

export function quoteHeartCounts(segments: readonly PriceSegment[]) {
  let paidHearts = 0;
  let giftHearts = 0;
  for (const segment of segments) {
    const gifts = segment.giftHearts ?? 0;
    if (
      !Number.isSafeInteger(segment.hearts) || segment.hearts < 0 ||
      !Number.isSafeInteger(gifts) || gifts < 0 ||
      (segment.hearts === 0 && gifts === 0)
    ) return null;
    paidHearts += segment.hearts;
    giftHearts += gifts;
    if (!Number.isSafeInteger(paidHearts + giftHearts)) return null;
  }
  return { paidHearts, giftHearts, fulfillmentHearts: paidHearts + giftHearts };
}

export function calculateQuoteAmounts(
  segments: readonly PriceSegment[],
  discountedHeartsAmountCents?: number,
): QuoteAmounts | null {
  const counts = quoteHeartCounts(segments);
  if (!counts) return null;
  let originalHeartsAmountCents = 0;
  let fulfillmentAmountCents = 0;
  for (const { hearts, giftHearts = 0, unitPriceCents } of segments) {
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) return null;
    originalHeartsAmountCents += hearts * unitPriceCents;
    fulfillmentAmountCents += (hearts + giftHearts) * unitPriceCents;
    if (!Number.isSafeInteger(fulfillmentAmountCents)) return null;
  }
  if (discountedHeartsAmountCents !== undefined && (
    counts.giftHearts > 0 ||
    !Number.isSafeInteger(discountedHeartsAmountCents) || discountedHeartsAmountCents < 0 ||
    discountedHeartsAmountCents >= originalHeartsAmountCents
  )) return null;
  const heartsAmountCents = discountedHeartsAmountCents ?? originalHeartsAmountCents;
  return {
    heartsAmountCents,
    totalAmountCents: heartsAmountCents,
    ...(discountedHeartsAmountCents === undefined ? {} : { originalHeartsAmountCents }),
  };
}

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
