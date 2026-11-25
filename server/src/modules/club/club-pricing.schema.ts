import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { COMMISSION_BASES, PRICING_PERIODS, USER_ID_PATTERN } from '@webapp-template/common';
import type { CommissionBasis, PricingPeriod } from '@webapp-template/common';

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
class ContinuationQuote {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: GiftPriceSegmentSchema, required: true })
  segment: GiftPriceSegment;

  @Prop({ ...wholeNumber, min: 1 })
  amountCents: number;
}

export const ContinuationQuoteSchema = SchemaFactory.createForClass(ContinuationQuote);

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

  @Prop({ ...wholeNumber, min: 1 })
  hearts: number;

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

  @Prop({ type: String, enum: COMMISSION_BASES, required: true })
  basis: CommissionBasis;

  @Prop({ ...wholeNumber, min: 0 })
  dispatchFeeCents: number;

  @Prop({ type: [PriceSegmentSchema], required: true })
  segments: PriceSegment[];

  @Prop({ type: UnlockPricingSchema })
  unlock?: UnlockPricing;

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
export class StoredGiftQuote {
  @Prop({ ...wholeNumber, min: 1 })
  revision: number;

  @Prop({ type: String, enum: ['gift_times'], required: true })
  priceUnit: 'gift_times';

  @Prop({ type: [GiftPriceSegmentSchema], required: true })
  giftSegments: GiftPriceSegment[];

  @Prop({ type: [PriceSegmentSchema], required: true })
  segments: PriceSegment[];

  @Prop({ type: UnlockPricingSchema, required: true })
  unlock: UnlockPricing;

  @Prop({ ...wholeNumber, min: 1 })
  heartsAmountCents: number;

  @Prop({ ...wholeNumber, min: 0 })
  unlockAmountCents: number;

  @Prop({ ...wholeNumber, min: 1 })
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

  @Prop({ ...wholeNumber, min: 1 })
  receivedAmountCents: number;

  @Prop({ type: SchemaFactory.createForClass(StoredGiftQuote), required: true })
  quote: StoredGiftQuote;
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
