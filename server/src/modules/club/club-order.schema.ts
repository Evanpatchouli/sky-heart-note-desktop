import type { DailyReport } from './club-delivery.schema';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DELIVERY_PERIOD_PREFERENCES, USER_ID_PATTERN } from '@webapp-template/common';
import type { ContinuationQuote, DeliveryPeriodPreference, DispatchPricing, OrderPricing } from '@webapp-template/common';
import { SchemaTypes, Types } from 'mongoose';
import type { GiftDispatchState } from './club-gift-allocation';
import {
  CommissionReviewSchema,
  DispatchPricingSchema,
  ContinuationQuoteSchema,
  OrderPricingSchema,
  OrderReceiptSchema,
  type CommissionReview,
  type StoredOrderReceipt,
} from './club-pricing.schema';
import { CLUB_ID_PATTERN } from './club.schema';

export const ORDER_SOURCES = ['direct_dispatch', 'client_order'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

@Schema({ _id: false })
class HeartDelivery {
  @Prop({
    type: Number,
    min: 1,
    validate: Number.isSafeInteger,
  })
  requestedHearts?: number;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  requestedGiftTimes?: number;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  estimatedReceivedHearts?: number;

  @Prop({ type: Boolean })
  estimatedReceivedHeartsDerived?: boolean;

  @Prop({ type: String, enum: DELIVERY_PERIOD_PREFERENCES })
  deliveryPeriodPreference?: DeliveryPeriodPreference;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  doubleGiftTimes?: number;
}

@Schema()
export class ExecutionGameAccount {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  name: string;
}

@Schema()
export class ClubOrderShare {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  userId: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: Number.isSafeInteger,
  })
  hearts: number;

  @Prop({
    type: [SchemaFactory.createForClass(ExecutionGameAccount)],
    default: [],
  })
  executionGameAccounts: ExecutionGameAccount[];
}

@Schema({ _id: false })
export class PendingAssignmentDecision {
  @Prop({ type: String, enum: ['assigned', 'cancelled'], required: true })
  kind: 'assigned' | 'cancelled';

  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  actorUserId: string;

  @Prop({ type: Date, required: true })
  decidedAt: Date;

  @Prop({ type: String, match: USER_ID_PATTERN })
  dispatcherUserId?: string;
}

@Schema({ collection: 'club_orders', timestamps: true, versionKey: false })
export class ClubOrder {
  _id: Types.ObjectId;
  createdAt: Date;

  @Prop({
    type: String,
    required: true,
    match: CLUB_ID_PATTERN,
    immutable: true,
  })
  clubId: string;

  @Prop({ type: String, enum: ORDER_SOURCES, required: true, immutable: true })
  source: OrderSource;

  @Prop({
    type: String,
    enum: ['heart_delivery'],
    required: true,
    immutable: true,
  })
  businessType: 'heart_delivery';

  @Prop({
    type: String,
    required: true,
    match: USER_ID_PATTERN,
    immutable: true,
  })
  createdByUserId: string;

  @Prop({ type: String, required: true, immutable: true })
  requestId: string;

  @Prop({ type: String, match: USER_ID_PATTERN })
  customerUserId?: string;

  @Prop({
    type: String,
    enum: ['verified', 'pending_verification'],
    required: true,
  })
  customerLinkStatus: 'verified' | 'pending_verification';

  @Prop({ type: String, trim: true, maxlength: 80 })
  customerLabel?: string;

  @Prop({ type: String, match: USER_ID_PATTERN, immutable: true })
  selectedCustomerUserId?: string;

  @Prop({ type: String, maxlength: 100, immutable: true })
  newCustomerNickname?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  recipientGameAccount: string;

  @Prop({ type: String, match: USER_ID_PATTERN })
  dispatcherUserId?: string;

  @Prop({ type: String, match: USER_ID_PATTERN, immutable: true })
  requestedDispatcherUserId?: string;

  @Prop({
    type: String,
    enum: ['creator', 'customer_selected', 'random', 'manual'],
  })
  dispatcherAssignment?: 'creator' | 'customer_selected' | 'random' | 'manual';

  @Prop({
    type: String,
    enum: ['draft', 'pending_assignment', 'pending', 'published', 'cancelled'],
    required: true,
  })
  dispatchStatus: 'draft' | 'pending_assignment' | 'pending' | 'published' | 'cancelled';

  @Prop({ type: SchemaFactory.createForClass(PendingAssignmentDecision) })
  pendingAssignmentDecision?: PendingAssignmentDecision;

  @Prop({ type: Date })
  publishedAt?: Date;

  @Prop({ type: OrderPricingSchema })
  pricing?: OrderPricing;

  @Prop({ type: DispatchPricingSchema })
  dispatchPricing?: DispatchPricing;

  @Prop({ type: OrderReceiptSchema })
  receipt?: StoredOrderReceipt;

  @Prop({ type: CommissionReviewSchema })
  commissionReview?: CommissionReview;

  @Prop({ type: String })
  giftPublicationRequestId?: string;

  @Prop({ type: SchemaTypes.Mixed })
  giftDispatch?: GiftDispatchState;

  @Prop({ type: String })
  giftPublicationScheduleFingerprint?: string;

  @Prop({ type: Number })
  fulfillmentRevision?: number;

  @Prop({ type: SchemaTypes.Mixed })
  pendingDailyReport?: DailyReport;

  @Prop({ type: [ContinuationQuoteSchema], default: undefined })
  continuationQuotes?: ContinuationQuote[];

  @Prop({ type: SchemaFactory.createForClass(HeartDelivery), required: true })
  heartDelivery: HeartDelivery;

  @Prop({ type: [SchemaFactory.createForClass(ClubOrderShare)], default: [] })
  shares: ClubOrderShare[];
}

export const ClubOrderSchema = SchemaFactory.createForClass(ClubOrder);

ClubOrderSchema.index(
  { clubId: 1, source: 1, createdByUserId: 1, requestId: 1 },
  { unique: true },
);
ClubOrderSchema.index({ clubId: 1, _id: -1 });
ClubOrderSchema.index({ 'pendingDailyReport._id': 1 }, { sparse: true });
ClubOrderSchema.index(
  { clubId: 1, dispatchStatus: 1, _id: -1 },
  {
    partialFilterExpression: { 'dispatchPricing.version': { $exists: true } },
  },
);
ClubOrderSchema.index({
  clubId: 1,
  customerUserId: 1,
  customerLinkStatus: 1,
  _id: -1,
});
ClubOrderSchema.index({ clubId: 1, dispatcherUserId: 1, _id: -1 });
ClubOrderSchema.index(
  { clubId: 1, dispatchStatus: 1, source: 1, _id: -1 },
  { partialFilterExpression: { dispatchStatus: 'pending_assignment', source: 'client_order' } },
);
ClubOrderSchema.index({ customerUserId: 1, customerLinkStatus: 1, _id: -1 });
ClubOrderSchema.index({
  clubId: 1,
  'shares.userId': 1,
  dispatchStatus: 1,
  _id: -1,
});
