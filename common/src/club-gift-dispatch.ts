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
  actualReceivedHearts?: number;
  transferredGiftTimes?: number;
  deliveredGiftTimes?: number;
}

export interface GiftClaimResult {
  shareId?: string;
  dailyGiftTimes: number;
  giftTimes: number;
  actualReceivedHearts?: number;
}

export interface GiftDispatchSegment extends GiftWindow {
  segmentIndex: number;
  openToClaim: boolean;
  publicDailyGiftTimes: number;
  publicRemainingGiftTimes: number;
  publicSchedule: GiftDayAllocation[];
  offers: GiftOffer[];
  shares: GiftShare[];
}

export interface GiftDispatchPreparation {
  quotes: GiftPriceSegment[];
  segments: GiftDispatchSegment[];
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
