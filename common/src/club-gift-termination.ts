import type { GiftPricePayment } from './club-gift-price-adjustment';

export interface GiftTerminationChange {
  reason: string;
  recordedAt: string;
  recordedByUserId: string;
}

export interface GiftTermination {
  id: string;
  revision: number;
  origin: 'customer_request' | 'reported_customer_request' | 'declined_adjustment';
  stoppedAt: string;
  reason?: string;
  customerRequestReference?: string;
  change?: GiftTerminationChange;
  deliveredGiftTimes: number;
  stoppedGiftTimes: number;
  stoppedPaidGiftTimes: number;
  stoppedPromotionalGiftTimes: number;
  fulfilledServiceCents: number;
  fulfilledPersonalDiscountCents: number;
  fulfilledPlatformDiscountCents: number;
  originalReceivedCents: number;
  continuationReceivedCents: number;
  supplementReceivedCents: number;
  refundDueCents: number;
  refundedCents: number;
  refundRemainingCents: number;
  excessRefundCents: number;
  netReceivedCents: number;
  refunds: GiftPricePayment[];
  couponStatus?: 'used' | 'returned';
  couponReturnedAt?: string;
}

export type CustomerGiftTermination = Omit<GiftTermination, 'customerRequestReference' | 'change' | 'refunds'> & {
  change?: Pick<GiftTerminationChange, 'reason'>;
  refunds: Pick<GiftPricePayment, 'amountCents' | 'occurredAt'>[];
};
