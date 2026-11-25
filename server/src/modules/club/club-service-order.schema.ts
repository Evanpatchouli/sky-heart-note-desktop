import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BUSINESS_DATE_PATTERN, serviceBusinessLabels, servicePostingLabel, USER_ID_PATTERN, type ServiceBusinessType, type ServiceOrderAction, type ServiceOrderStatus } from '@sky-club/common';
import type { Types } from 'mongoose';

const cents = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const userId = { type: String, required: true, match: USER_ID_PATTERN };
const calendarDate = { type: String, required: true, match: BUSINESS_DATE_PATTERN };

@Schema({ _id: false })
class ServiceOrderQuote {
  @Prop(cents)
  unitPriceCents: number;

  @Prop(cents)
  dispatchFeeCents: number;

  @Prop(cents)
  clubFeeCents: number;

  @Prop(cents)
  totalCents: number;
}

@Schema({ _id: false })
class ServiceOrderReceipt {
  @Prop(cents)
  amountCents: number;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop(userId)
  recordedByUserId: string;
}

@Schema({ _id: false })
class StoredServiceOrderDelivery {
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  unit: number;

  @Prop(calendarDate)
  businessDate: string;

  @Prop({ type: String, required: true, maxlength: 500 })
  evidence: string;

  @Prop({ type: Date, required: true })
  submittedAt: Date;

  @Prop({ type: Date })
  acceptedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;
}

@Schema({ _id: false })
class ServiceOrderStop {
  @Prop({ type: String, required: true, maxlength: 240 })
  reason: string;

  @Prop({ type: Date, required: true })
  stoppedAt: Date;

  @Prop(userId)
  stoppedByUserId: string;
}

@Schema({ _id: false })
class ServiceOrderCommand {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: String, required: true, enum: ['assign', 'publish', 'claim', 'start', 'deliveries', 'accept', 'stop', 'refund', 'close'] })
  action: ServiceOrderAction;

  @Prop(userId)
  actorUserId: string;

  @Prop({ type: String, required: true })
  inputHash: string;
}

@Schema({ _id: false })
class ServiceOrderRefund {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ ...cents, min: 1 })
  amountCents: number;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop(userId)
  recordedByUserId: string;

  @Prop({ type: String })
  transferReference?: string;
}

@Schema({ _id: false })
export class ServiceOrderPosting {
  @Prop({ type: String, required: true, enum: Object.keys(servicePostingLabel) })
  kind: keyof typeof servicePostingLabel;

  @Prop({ ...userId, required: false })
  memberUserId: string | null;

  @Prop({ ...cents, min: 1 })
  amountCents: number;
}

@Schema({ _id: false })
class ServiceOrderClose {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: Date, required: true })
  closedAt: Date;

  @Prop(userId)
  closedByUserId: string;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  acceptedUnits: number;

  @Prop(cents)
  netReceivedCents: number;

  @Prop({ type: [SchemaFactory.createForClass(ServiceOrderPosting)], default: [] })
  postings: ServiceOrderPosting[];
}

@Schema({ collection: 'club_service_orders', timestamps: true, versionKey: false })
export class ClubServiceOrder {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, immutable: true })
  clubId: string;

  @Prop({ type: String, required: true, immutable: true, enum: Object.keys(serviceBusinessLabels) })
  businessType: ServiceBusinessType;

  @Prop({ type: String, required: true, immutable: true, enum: ['client_order', 'direct_dispatch'] })
  source: 'client_order' | 'direct_dispatch';

  @Prop({ ...userId, immutable: true })
  createdByUserId: string;

  @Prop({ type: String, required: true, immutable: true })
  requestId: string;

  @Prop({ type: String, required: true, immutable: true })
  creationHash: string;

  @Prop({ ...userId, immutable: true })
  customerUserId: string;

  @Prop({ ...userId, required: false })
  dispatcherUserId?: string;

  @Prop({ ...userId, required: false })
  executorUserId?: string;

  @Prop({ type: String, required: true, immutable: true, maxlength: 120 })
  recipientGameAccount: string;

  @Prop({ type: String, required: true, immutable: true, maxlength: 500 })
  serviceDescription: string;

  @Prop({ ...calendarDate, immutable: true })
  startDate: string;

  @Prop({ type: Date, immutable: true })
  scheduledStartAt?: Date;

  @Prop({ type: Date, immutable: true })
  scheduledEndAt?: Date;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: [Date], default: undefined })
  occupiedSlots?: Date[];

  @Prop({ type: Number, required: true, immutable: true, min: 1, validate: Number.isSafeInteger })
  units: number;

  @Prop({ type: String, required: true, enum: ['pending_assignment', 'pending_dispatch', 'published', 'claimed', 'completed', 'stopped'] })
  status: ServiceOrderStatus;

  @Prop({ type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger })
  revision: number;

  @Prop({ type: SchemaFactory.createForClass(ServiceOrderQuote), required: true, immutable: true })
  quote: ServiceOrderQuote;

  @Prop({ type: SchemaFactory.createForClass(ServiceOrderReceipt) })
  receipt?: ServiceOrderReceipt;

  @Prop({ type: Date })
  publishedAt?: Date;

  @Prop({ type: Date })
  claimedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: SchemaFactory.createForClass(ServiceOrderStop) })
  stop?: ServiceOrderStop;

  @Prop({ type: [SchemaFactory.createForClass(StoredServiceOrderDelivery)], default: [] })
  deliveries: StoredServiceOrderDelivery[];

  @Prop({ type: [SchemaFactory.createForClass(ServiceOrderCommand)], default: [] })
  commands: ServiceOrderCommand[];

  @Prop({ type: [SchemaFactory.createForClass(ServiceOrderRefund)], default: undefined })
  refunds?: ServiceOrderRefund[];

  @Prop({ type: SchemaFactory.createForClass(ServiceOrderClose) })
  close?: ServiceOrderClose;
}

export const ClubServiceOrderSchema = SchemaFactory.createForClass(ClubServiceOrder);
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, source: 1, createdByUserId: 1, requestId: 1 }, { unique: true });
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, _id: -1 });
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, status: 1, _id: -1 });
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, customerUserId: 1, _id: -1 });
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, dispatcherUserId: 1, _id: -1 });
ClubServiceOrderSchema.index({ clubId: 1, businessType: 1, executorUserId: 1, _id: -1 });
const closed = { partialFilterExpression: { 'close.closedAt': { $type: 'date' as const } } };
ClubServiceOrderSchema.index({ clubId: 1, 'close.closedAt': 1 }, closed);
ClubServiceOrderSchema.index({ clubId: 1, 'close.postings.memberUserId': 1 }, closed);
ClubServiceOrderSchema.index({ clubId: 1, executorUserId: 1, occupiedSlots: 1 }, {
  unique: true, partialFilterExpression: { businessType: 'companionship', occupiedSlots: { $type: 'date' } },
});
