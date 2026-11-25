import type { PricingPeriod } from './club-pricing';

export interface GiftPriceShift {
  quoteSegment: number;
  giftTimes: number;
  targetPeriod: PricingPeriod;
  targetUnitPriceCents: number;
}

export interface GiftPricePreview extends GiftPriceShift {
  originalQuoteCents: number;
  currentQuoteCents: number;
  cumulativeReceivedCents: number;
  agreedGiftTimes: number;
  deliveredGiftTimes: number;
  remainingGiftTimes: number;
  segmentRemainingGiftTimes: number;
  actualReceivedHearts: number | string | null;
  originalUnitPriceCents: number;
  originalPeriod: PricingPeriod;
  proposedTotalCents: number | null;
  differenceCents: number | null;
  refundIfDeclinedCents: number | null;
  adjustmentReview: { version: string } | { unavailable: 'no_price_change' | 'lower_price' | 'adjustment_unavailable' };
}

export interface GiftPriceDecision {
  value: 'accept' | 'decline';
  source: 'customer' | 'offline';
  decidedByUserId: string;
  decidedAt: string;
  recordedAt: string;
  requestId: string;
  evidence?: string;
}

export interface GiftPricePayment {
  kind: 'supplement' | 'refund';
  amountCents: number;
  reason: string;
  occurredAt: string;
  recordedAt: string;
  recordedByUserId: string;
  requestId: string;
  refundDueAtRecordingCents?: number;
}

export interface GiftPriceAdjustment {
  id: string;
  revision: number;
  state: 'awaiting_decision' | 'awaiting_supplement' | 'continuing' | 'stopped' | 'needs_requote' | 'superseded';
  preview: GiftPricePreview;
  reason: string;
  submittedByUserId: string;
  submittedAt: string;
  requestId: string;
  decision?: GiftPriceDecision;
  latestFactChange?: { reportId: string; version: number; recordedAt: string };
  resumed?: { requestId: string; recordedByUserId: string; recordedAt: string };
  payments: GiftPricePayment[];
  newQuoteSegment?: number;
  originalReceivedCents: number;
  cumulativeReceivedCents: number;
  supplementReceivedCents: number;
  refundDueCents: number;
  refundedCents: number;
  netReceivedCents: number;
}
