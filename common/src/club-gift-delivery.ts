import type { PricingPeriod } from './club-pricing';

export type GiftReportPeriod = PricingPeriod | 'unconfirmed';

export interface GiftReportLine {
  shareId: string;
  quoteSegment?: number;
  period: GiftReportPeriod;
  giftTimes: number;
  receivedHearts: number | null;
}

export interface GiftDailyReport {
  id: string;
  originalId: string;
  orderId: string;
  priceUnit: 'gift_times';
  userId: string;
  memberNickname: string | null;
  shareId: string;
  accountId: string;
  accountName: string;
  accountLocalId: string | null;
  recipientGameAccount: string;
  businessDate: string;
  submittedAt: string;
  kind: 'daily' | 'supplement' | 'correction';
  version: number;
  latestVersion?: number;
  status: 'recorded';
  reason: string | null;
  lines: GiftReportLine[];
  giftTimes: number | string;
  receivedHearts: number | null;
  previous: Pick<GiftDailyReport, 'version' | 'userId' | 'submittedAt' | 'lines' | 'giftTimes' | 'receivedHearts'> | null;
}

export interface GiftShareProgress {
  shareId: string;
  segmentIndex: number;
  observedGiftTimes: number | string;
  deliveredGiftTimes: number;
  remainingGiftTimes: number;
  excessGiftTimes: number | string;
  actualReceivedHearts: number | string | null;
  knownReceivedHearts: number | string;
  knownReceivedLines: number;
  unknownReceivedLines: number;
  claimObservedReceivedHearts: number | null;
}

type ReportCount = number | string;

export interface GiftPeriodProgress {
  period: GiftReportPeriod;
  observedGiftTimes: ReportCount;
  deliveredGiftTimes: number | null;
  estimatedDeliveredHearts: ReportCount | null;
  actualReceivedHearts: ReportCount | null;
  knownReceivedHearts: ReportCount;
  knownReceivedLines: number;
  unknownReceivedLines: number;
  heartAmountCents: number | null;
}

export interface GiftPerformance {
  observedGiftTimes: ReportCount;
  excessGiftTimes: ReportCount;
  pendingPromotionalGiftTimes?: ReportCount;
  estimatedDeliveredHearts: ReportCount | null;
  heartAmountCents: number | null;
  periods: GiftPeriodProgress[];
}

export interface GiftCompensation {
  giftTimes: number;
  grossCents: number;
  dispatchFeeCents: number;
  clubFeeCents: number;
  memberCents: number;
}

export interface GiftDeliverySegment extends GiftPerformance {
  segmentIndex: number;
  promotionalGiftTimes?: number;
  quotePeriod: PricingPeriod;
  unitPriceCents: number;
  deliveredGiftTimes: number;
  remainingGiftTimes: number;
  pendingCompensation: GiftCompensation | null;
}

export interface GiftDeliveryProgress extends Omit<GiftShareProgress, 'shareId' | 'segmentIndex' | 'claimObservedReceivedHearts'>, GiftPerformance {
  priceUnit: 'gift_times';
  orderDeliveredGiftTimes: number;
  orderRemainingGiftTimes: number;
  estimatedReceivedHearts: number | null;
  canSubmitDaily: boolean;
  canCorrectReports: boolean;
  shares: GiftShareProgress[];
  segments: GiftDeliverySegment[];
  pendingCompensation: GiftCompensation | null;
  compensationIssue: 'out_of_range' | 'negative_amount' | null;
}
