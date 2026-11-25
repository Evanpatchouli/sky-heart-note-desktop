import type { GiftWindow } from './club-gift-dispatch';
import type { GiftPerformance } from './club-gift-delivery';
import type { GiftPriceSegment } from './club-pricing';

type ReportCount = number | string;

export interface GiftSupervisionTotals extends GiftPerformance {
  agreedGiftTimes: number;
  deliveredGiftTimes: number;
  remainingGiftTimes: number;
  actualReceivedHearts: ReportCount | null;
  knownReceivedHearts: ReportCount;
  knownReceivedLines: number;
  unknownReceivedLines: number;
}

export interface CustomerGiftSegment extends GiftSupervisionTotals, GiftPriceSegment {
  segmentIndex: number;
  window: GiftWindow | null;
  estimatedReceivedHearts: number | null;
  claimObservedReceivedHearts: number[];
  unknownClaimObservations: number;
}

export interface CustomerGiftProgress extends GiftSupervisionTotals {
  priceUnit: 'gift_times';
  paidGiftTimes?: number;
  promotionalGiftTimes?: number;
  deliveredPaidGiftTimes?: number;
  deliveredPromotionalGiftTimes?: number;
  estimatedReceivedHearts: number | null;
  claimObservedReceivedHearts: number[];
  unknownClaimObservations: number;
  segments: CustomerGiftSegment[];
  fulfillmentStatus: 'not_started' | 'in_progress' | 'completed' | 'stopped';
  closedAt: string | null;
  canRequestContinuation: boolean;
  periodOnlyDifferenceCents: 0;
}

export function isGiftOrderProgress(value: object | null | undefined): value is CustomerGiftProgress {
  return !!value && 'priceUnit' in value && value.priceUnit === 'gift_times';
}

export interface GiftSupervisionDay {
  businessDate: string;
  plannedGiftTimes: number;
  reportedGiftTimes: ReportCount;
  actualReceivedHearts: ReportCount | null;
  status: 'not_checked' | 'future' | 'missing' | 'reported_zero' | 'short' | 'on_track' | 'unplanned';
}

export interface GiftMemberSupervision extends GiftSupervisionTotals {
  userId: string;
  nickname: string | null;
  originallyClaimedGiftTimes: number;
  transferredGiftTimes: number;
  overdueGiftTimes: number;
  shares: (GiftSupervisionTotals & {
    shareId: string;
    claimObservedReceivedHearts: number | null;
    originalWindow: GiftWindow;
    window: GiftWindow | null;
    transferredGiftTimes: number;
    overdueGiftTimes: number;
    days: GiftSupervisionDay[];
  })[];
  days: GiftSupervisionDay[];
}

export interface GiftDispatchSupervision extends Omit<CustomerGiftProgress, 'segments'> {
  through: string | null;
  hasExceptions: boolean;
  promotionBasis?: {
    grossServiceCents: number;
    customerServiceCents: number;
    personalDiscountCents: number;
    platformDiscountCents: number;
    promotionalGiftCostCents: number;
    unfulfilledServiceCents: number;
    dispatchFeeCents: number | null;
    clubFeeCents: number | null;
    memberFeeCents: number | null;
  };
  segments: (CustomerGiftSegment & {
    claimedGiftTimes: number;
    unclaimedGiftTimes: number;
    overdueUnclaimedGiftTimes: number;
    members: GiftMemberSupervision[];
  })[];
}
