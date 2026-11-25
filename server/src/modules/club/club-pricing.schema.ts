import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { COMMISSION_BASES, PRICING_PERIODS, USER_ID_PATTERN } from '@webapp-template/common';
import type { CommissionBasis, GiftQuotePromotions, PricingPeriod } from '@webapp-template/common';
import { SchemaTypes } from 'mongoose';

const wholeNumber = {
  type: Number,
  required: true,
  validate: Number.isSafeInteger,
};

@Schema({ _id: false })
class GiftPriceSegment {
  @Prop({ type: String, enum: PRICING_PERIODS, required: true })
  period: PricingPeriod;

  @Prop({ ...wholeNumber, min: 1 })
  paidGiftTimes: number;

  @Prop({ ...wholeNumber, min: 1 })
  dailyGiftTimes: number;

  @Prop({ ...wholeNumber, min: 1 })
  unitPriceCents: number;
}

const GiftPriceSegmentSchema = SchemaFactory.createForClass(GiftPriceSegment);

const giftPriceSegments = {
  type: [GiftPriceSegmentSchema],
  default: undefined,
};

@Schema({ _id: false })
class ContinuationWindow {
  @Prop({ type: String, required: true })
  startDate: string;

  @Prop({ type: String, required: true })
  endDate: string;
}

const continuationWindowSchema = SchemaFactory.createForClass(ContinuationWindow);

@Schema({ _id: false })
export class StoredContinuationRequest extends ContinuationWindow {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: String, enum: PRICING_PERIODS, required: true })
  period: PricingPeriod;

  @Prop({ ...wholeNumber, min: 1 })
  paidGiftTimes: number;

  @Prop({ ...wholeNumber, min: 1 })
  dailyGiftTimes: number;

  @Prop({ type: Date, required: true })
  requestedAt: Date;
}

export const ContinuationRequestSchema = SchemaFactory.createForClass(StoredContinuationRequest);

@Schema({ _id: false })
class ContinuationAcceptance {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: Date, required: true })
  acceptedAt: Date;
}

@Schema({ _id: false })
class ContinuationReceipt {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ ...wholeNumber, min: 1 })
  receivedAmountCents: number;

  @Prop({ type: Date, required: true })
  receivedAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop({ type: String, match: USER_ID_PATTERN, required: true })
  recordedByUserId: string;
}

@Schema({ _id: false })
export class StoredContinuationQuote {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: GiftPriceSegmentSchema, required: true })
  segment: GiftPriceSegment;

  @Prop({ ...wholeNumber, min: 1 })
  amountCents: number;

  @Prop({ type: String })
  customerRequestId?: string;

  @Prop({ type: continuationWindowSchema })
  window?: ContinuationWindow;

  @Prop({ type: Boolean })
  windowAddedAfterQuote?: boolean;

  @Prop({ type: SchemaFactory.createForClass(ContinuationAcceptance) })
  acceptance?: ContinuationAcceptance;

  @Prop({ type: SchemaFactory.createForClass(ContinuationReceipt) })
  receipt?: ContinuationReceipt;

  @Prop({ type: Number, min: 0, validate: Number.isSafeInteger })
  segmentIndex?: number;
}

export const ContinuationQuoteSchema = SchemaFactory.createForClass(StoredContinuationQuote);

@Schema({ _id: false })
class CommissionRule {
  @Prop({ ...wholeNumber, min: 1 })
  version: number;

  @Prop({ type: String, enum: COMMISSION_BASES, required: true })
  basis: CommissionBasis;

  @Prop({ ...wholeNumber, min: 0 })
  clubFeeCents: number;
}

@Schema({ _id: false })
class PriceSegment {
  @Prop({ type: String, enum: PRICING_PERIODS, required: true })
  period: PricingPeriod;

  @Prop({ ...wholeNumber, min: 0 })
  hearts: number;

  @Prop({ type: Number, min: 0, validate: Number.isSafeInteger })
  giftHearts?: number;

  @Prop({ ...wholeNumber, min: 1 })
  unitPriceCents: number;
}

const PriceSegmentSchema = SchemaFactory.createForClass(PriceSegment);

@Schema({ _id: false })
class UnlockPricing {
  @Prop({ ...wholeNumber, min: 0 })
  quantity: number;

  @Prop({ ...wholeNumber, min: 0 })
  unitPriceCents: number;

  @Prop({ type: Boolean })
  unitPriceAgreed?: boolean;
}

const UnlockPricingSchema = SchemaFactory.createForClass(UnlockPricing);

@Schema({ _id: false })
class OrderPricing {
  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  ruleVersion?: number;

  @Prop({ type: String, enum: ['gift_times'] })
  priceUnit?: 'gift_times';

  @Prop(giftPriceSegments)
  giftSegments?: GiftPriceSegment[];

  @Prop({ type: SchemaTypes.Mixed })
  promotions?: GiftQuotePromotions;

  @Prop({ type: Number, enum: [1] })
  unlockRateVersion?: 1;

  @Prop({ type: String, enum: COMMISSION_BASES, required: true })
  basis: CommissionBasis;

  @Prop({ ...wholeNumber, min: 0 })
  dispatchFeeCents: number;

  @Prop({ type: [PriceSegmentSchema], required: true })
  segments: PriceSegment[];

  @Prop({ type: UnlockPricingSchema })
  unlock?: UnlockPricing;

  @Prop({ type: Number, min: 0, validate: Number.isSafeInteger })
  discountedHeartsAmountCents?: number;

  @Prop({ ...wholeNumber, min: 1 })
  revision: number;
}

@Schema({ _id: false })
class DispatchPricing extends OrderPricing {
  @Prop({ ...wholeNumber, min: 1 })
  version: number;

  @Prop({ ...wholeNumber, min: 0 })
  clubFeeCents: number;
}

@Schema({ _id: false })
class CustomerQuote {
  @Prop({ ...wholeNumber, min: 1 })
  revision: number;

  @Prop({ type: String, enum: ['gift_times'] })
  priceUnit?: 'gift_times';

  @Prop(giftPriceSegments)
  giftSegments?: GiftPriceSegment[];

  @Prop({ type: SchemaTypes.Mixed })
  promotions?: GiftQuotePromotions;

  @Prop({ type: Number, enum: [1] })
  unlockRateVersion?: 1;

  @Prop({ type: [PriceSegmentSchema], required: true })
  segments: PriceSegment[];

  @Prop({ type: UnlockPricingSchema, required: true })
  unlock: UnlockPricing;

  @Prop({ ...wholeNumber, min: 0 })
  heartsAmountCents: number;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  originalHeartsAmountCents?: number;

  @Prop({ ...wholeNumber, min: 0 })
  unlockAmountCents: number;

  @Prop({ ...wholeNumber, min: 0 })
  totalAmountCents: number;
}

@Schema({ _id: false })
export class StoredOrderReceipt {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  receivedByUserId: string;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  recordedByUserId: string;

  @Prop({ type: Date, required: true })
  receivedAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop({ ...wholeNumber, min: 0 })
  receivedAmountCents: number;

  @Prop({ type: SchemaFactory.createForClass(CustomerQuote), required: true })
  quote: CustomerQuote;
}

@Schema({ _id: false })
export class CommissionReview {
  @Prop({ ...wholeNumber, min: 1 })
  revision: number;

  @Prop({ ...wholeNumber, min: 1 })
  ruleVersion: number;

  @Prop({ type: String, enum: ['gift_times'], required: true })
  basis: 'gift_times';

  @Prop({ ...wholeNumber, min: 0 })
  dispatchFeeCents: number;
}

export const OrderReceiptSchema = SchemaFactory.createForClass(StoredOrderReceipt);
export const CommissionReviewSchema = SchemaFactory.createForClass(CommissionReview);

export const CommissionRuleSchema =
  SchemaFactory.createForClass(CommissionRule);
export const OrderPricingSchema = SchemaFactory.createForClass(OrderPricing);
export const DispatchPricingSchema =
  SchemaFactory.createForClass(DispatchPricing);
