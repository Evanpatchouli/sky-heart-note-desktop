import type { GiftPriceSegment } from './club-pricing';

export interface GiftWindow {
  startDate: string;
  endDate: string;
}

export interface GiftDirectedAssignment extends GiftWindow {
  userId: string;
  dailyGiftTimes: number;
}

export interface GiftSegmentDispatchInput extends GiftWindow {
  segmentIndex: number;
  openToClaim: boolean;
  directed: GiftDirectedAssignment[];
}

export interface GiftDayAllocation extends GiftWindow {
  dailyGiftTimes: number;
}

export interface GiftOffer extends GiftDirectedAssignment {
  schedule: GiftDayAllocation[];
  id: string;
  giftTimes: number;
  transferredFromShareId?: string;
  accepted: boolean;
}

export interface GiftShare extends GiftDirectedAssignment {
  schedule: GiftDayAllocation[];
  id: string;
  kind: 'public' | 'directed';
  giftTimes: number;
  netGiftTimes: number;
  originalSchedule?: GiftDayAllocation[];
  actualReceivedHearts?: number;
  transferredGiftTimes?: number;
  deliveredGiftTimes?: number;
}

export interface GiftClaimResult {
  shareId?: string;
  requestedDailyGiftTimes: number;
  additionalRequestedDailyGiftTimes?: number;
  dailyGiftTimes: number;
  giftTimes: number;
  schedule: GiftDayAllocation[];
  actualReceivedHearts?: number;
}

export interface GiftDispatchSegment extends GiftWindow {
  segmentIndex: number;
  openToClaim: boolean;
  publicDailyGiftTimes: number;
  publicRemainingGiftTimes: number;
  publicSchedule: GiftDayAllocation[];
  myPublicRequestedDailyGiftTimes?: number;
  offers: GiftOffer[];
  shares: GiftShare[];
}

export interface GiftAllocationTotals {
  paidGiftTimes: number;
  claimedGiftTimes: number;
  directedPendingGiftTimes: number;
  publicRemainingGiftTimes: number;
  unconfiguredGiftTimes: number;
  unallocatedGiftTimes: number;
}

export interface GiftDispatchPreparation {
  quotes: GiftPriceSegment[];
  segments: (GiftDispatchSegment & {
    memberAllocations: { userId: string; giftTimes: number; schedule: GiftDayAllocation[] }[];
  })[];
  acceptingClaims: boolean;
  totals: GiftAllocationTotals;
  segmentTotals: (GiftAllocationTotals & { segmentIndex: number; configured: boolean })[];
  candidates: { userId: string; nickname: string | null }[];
}

export interface GiftClaimOrder {
  id: string;
  source: 'direct_dispatch' | 'client_order';
  dispatcherUserId: string;
  requestedGiftTimes: number;
  estimatedReceivedHearts?: number;
  recipientGameAccount?: string;
  segments: GiftDispatchSegment[];
}
