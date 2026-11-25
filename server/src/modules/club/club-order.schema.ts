import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  BUSINESS_DATE_PATTERN,
  DELIVERY_PERIOD_PREFERENCES,
  USER_ID_PATTERN,
} from '@sky-club/common';
import type {
  CommissionReview,
  DeliveryPeriodPreference,
  DispatchPricing,
  OrderPricing,
} from '@sky-club/common';
import { Schema as MongooseSchema, SchemaTypes, Types } from 'mongoose';
import type { GiftDispatchState } from './club-gift-allocation';
import type { StoredGiftPriceAdjustment } from './club-gift-price-basis';
import type { StoredGiftTermination } from './club-gift-termination';
import type { StoredSettlementClose } from './club-settlement-close';
import type { OrderAdjustmentCommand } from './club-financial-adjustment.schema';
import type { StoredSettlementCorrection } from './club-settlement-correction.service';
import { CLAIM_KINDS, type ClaimKind } from './club-allocation.dto';
import {
  DispatchAllocation,
  DispatchAllocationSchema,
} from './club-allocation.schema';
import {
  DispatchPublication,
  DispatchPublicationSchema,
} from './club-dispatch-notice.schema';
import {
  DispatchPricingSchema,
  ContinuationQuoteSchema,
  ContinuationRequestSchema,
  StoredContinuationQuote,
  StoredContinuationRequest,
  CommissionReviewSchema,
  OrderPricingSchema,
  OrderReceiptSchema,
  StoredOrderReceipt,
} from './club-pricing.schema';
import { CLUB_ID_PATTERN } from './club.schema';
import type { DailyReport } from './club-delivery.schema';
import type { StoredPriceAdjustment, StoredPriceAdjustmentReview } from './club-price-adjustment';
import type { StoredTermination } from './club-termination';

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

  @Prop({ type: String, match: BUSINESS_DATE_PATTERN })
  agreedDeadline?: string;
}

@Schema()
export class ExecutionGameAccount {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, match: /^[a-f0-9]{32}$/ })
  personalAccountId?: string;

  @Prop({ type: String, match: /^-?\d+$/ })
  localAccountId?: string;

  @Prop({ type: Date })
  linkedAt?: Date;
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

  @Prop({ type: String })
  claimRequestId?: string;

  @Prop({ type: String, enum: CLAIM_KINDS })
  claimKind?: ClaimKind;

  @Prop({ type: Date })
  claimedAt?: Date;

  @Prop({ type: [String], default: undefined })
  agreedReportDates?: string[];

  @Prop({
    type: [SchemaFactory.createForClass(ExecutionGameAccount)],
    default: [],
  })
  executionGameAccounts: ExecutionGameAccount[];
}

@Schema({ _id: false })
export class PersonalSchedule {
  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  userId: string;

  @Prop({ type: String, match: BUSINESS_DATE_PATTERN, default: null })
  startDate: string | null;

  @Prop({ type: String, match: BUSINESS_DATE_PATTERN, default: null })
  endDate: string | null;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  revision: number;
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

  @Prop({ type: String, immutable: true })
  requestedPromotionCouponId?: string;

  @Prop({ type: String })
  activePromotionCouponId?: string;

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

  // Closing admissions preserves the original publication and existing shares.
  @Prop({ type: Date })
  dispatchWithdrawnAt?: Date;

  @Prop({ type: DispatchPublicationSchema })
  publication?: DispatchPublication;

  @Prop({ type: Date })
  intakeNoticePendingAt?: Date;

  @Prop({ type: DispatchAllocationSchema })
  allocation?: DispatchAllocation;

  @Prop({ type: OrderPricingSchema })
  pricing?: OrderPricing;

  @Prop({ type: DispatchPricingSchema })
  dispatchPricing?: DispatchPricing;

  @Prop({ type: String })
  giftPublicationRequestId?: string;

  @Prop({ type: SchemaTypes.Mixed })
  giftDispatch?: GiftDispatchState;

  @Prop({ type: [SchemaTypes.Mixed], default: undefined })
  giftPriceAdjustments?: StoredGiftPriceAdjustment[];

  @Prop({ type: String, enum: ['awaiting_decision', 'awaiting_supplement', 'continuing', 'stopped', 'needs_requote', 'superseded'] })
  giftPriceAdjustmentState?: StoredGiftPriceAdjustment['state'];

  @Prop({ type: SchemaTypes.Mixed })
  giftTermination?: StoredGiftTermination;

  @Prop({ type: String })
  promotionCouponReturnedAt?: string;

  @Prop({ type: String })
  giftPublicationScheduleFingerprint?: string;

  @Prop({ type: [ContinuationQuoteSchema], default: undefined })
  continuationQuotes?: StoredContinuationQuote[];

  @Prop({ type: [ContinuationRequestSchema], default: undefined })
  continuationRequests?: StoredContinuationRequest[];

  @Prop({ type: Number, min: 0, validate: Number.isSafeInteger })
  continuationRevision?: number;

  @Prop({ type: Date })
  closedAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  settlementClose?: StoredSettlementClose;

  @Prop({ type: Number })
  financialRevision?: number;

  @Prop({ type: SchemaTypes.Mixed })
  pendingFinancialAdjustment?: OrderAdjustmentCommand;

  @Prop({ type: [SchemaTypes.Mixed], default: undefined })
  settlementCorrections?: StoredSettlementCorrection[];

  @Prop({ type: Number })
  settlementCorrectionRevision?: number;

  // Frozen atomically with closedAt by the order settlement writer.
  @Prop({ type: [SchemaTypes.ObjectId], default: undefined })
  settlementPenaltyIds?: Types.ObjectId[];

  @Prop({ type: OrderReceiptSchema })
  receipt?: StoredOrderReceipt;

  @Prop({ type: CommissionReviewSchema })
  commissionReview?: CommissionReview;

  @Prop({ type: SchemaFactory.createForClass(HeartDelivery), required: true })
  heartDelivery: HeartDelivery;

  @Prop({ type: [SchemaFactory.createForClass(ClubOrderShare)], default: [] })
  shares: ClubOrderShare[];

  @Prop({ type: [SchemaFactory.createForClass(PersonalSchedule)], default: undefined })
  personalSchedules?: PersonalSchedule[];

  @Prop({ type: Number, min: 0, validate: Number.isSafeInteger })
  fulfillmentRevision?: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  pendingDailyReport?: DailyReport;

  @Prop({ type: MongooseSchema.Types.Mixed })
  priceAdjustment?: StoredPriceAdjustment;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  priceAdjustmentHistory?: StoredPriceAdjustment[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  priceAdjustmentReviews?: StoredPriceAdjustmentReview[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  termination?: StoredTermination;
}

export const ClubOrderSchema = SchemaFactory.createForClass(ClubOrder);

ClubOrderSchema.index({ activePromotionCouponId: 1 }, {
  unique: true, partialFilterExpression: { activePromotionCouponId: { $type: 'string' } },
});
ClubOrderSchema.index({ dispatcherUserId: 1, source: 1, dispatchStatus: 1, _id: -1 });

ClubOrderSchema.index(
  { clubId: 1, source: 1, createdByUserId: 1, requestId: 1 },
  { unique: true },
);
ClubOrderSchema.index({ clubId: 1, _id: -1 });
ClubOrderSchema.index({ clubId: 1, closedAt: 1 }, { partialFilterExpression: { closedAt: { $type: 'date' } } });
ClubOrderSchema.index({ 'pendingFinancialAdjustment.id': 1 }, { sparse: true });
ClubOrderSchema.index({ clubId: 1, 'settlementCorrections.status': 1 }, { sparse: true });
ClubOrderSchema.index(
  { 'pendingDailyReport._id': 1 },
  { sparse: true },
);
ClubOrderSchema.index({ 'publication.id': 1 }, { unique: true, sparse: true });
ClubOrderSchema.index({ intakeNoticePendingAt: 1 }, { sparse: true });
ClubOrderSchema.index(
  { 'publication.nextAttemptAt': 1, _id: 1 },
  { partialFilterExpression: { 'publication.pending': true } },
);
ClubOrderSchema.index(
  { 'publication.pushNextAttemptAt': 1 },
  { partialFilterExpression: {
    'publication.pending': false,
    'publication.pushNextAttemptAt': { $exists: true },
  } },
);
ClubOrderSchema.index(
  { clubId: 1, dispatchStatus: 1, _id: -1 },
  {
    partialFilterExpression: { 'dispatchPricing.version': { $exists: true } },
  },
);
ClubOrderSchema.index(
  {
    clubId: 1,
    dispatchStatus: 1,
    _id: -1,
  },
  {
    name: 'club_claim_board',
    partialFilterExpression: { 'allocation.requestId': { $exists: true } },
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

ClubOrderSchema.index({
  clubId: 1,
  'giftDispatch.segments.shares.userId': 1,
  dispatchStatus: 1,
  _id: -1,
});

ClubOrderSchema.index({
  clubId: 1,
  'giftDispatch.executionAccounts.userId': 1,
  dispatchStatus: 1,
  _id: -1,
});
