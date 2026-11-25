import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import type { GiftSettlementAdjustment } from '@webapp-template/common';

@Schema({ _id: false })
export class CompensationRefund {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  amountCents: number;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop({ type: String, required: true })
  recordedByUserId: string;

  @Prop({ type: String })
  evidence?: string;
}

// An order-linked penalty and its approval share one record. Writers must use
// the expected revision when changing approval or appending a refund receipt.
@Schema({ collection: 'club_financial_adjustments', versionKey: false })
export class ClubFinancialAdjustment {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, immutable: true })
  clubId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, immutable: true })
  orderId?: Types.ObjectId;

  @Prop({ type: String, enum: ['customer_compensation', 'member_penalty'], required: true, immutable: true })
  kind: GiftSettlementAdjustment['kind'];

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], required: true })
  status: GiftSettlementAdjustment['status'];

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  revision: number;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  amountCents: number;

  @Prop({ type: String, required: true })
  reason: string;

  @Prop({ type: String, required: true, immutable: true })
  requestedByUserId: string;

  @Prop({ type: String, immutable: true })
  requestId?: string;

  @Prop({ type: Date, required: true, immutable: true })
  createdAt: Date;

  @Prop({ type: String })
  decidedByUserId?: string;

  @Prop({ type: Date })
  decidedAt?: Date;

  @Prop({ type: String })
  decisionReason?: string;

  @Prop({ type: Date })
  notificationPublishedAt?: Date;

  @Prop({ type: String })
  memberUserId?: string;

  @Prop({ type: String, immutable: true })
  customerUserId?: string;

  @Prop({ type: [SchemaFactory.createForClass(CompensationRefund)], default: undefined })
  refunds?: CompensationRefund[];
}

export const ClubFinancialAdjustmentSchema = SchemaFactory.createForClass(ClubFinancialAdjustment);
ClubFinancialAdjustmentSchema.index({ clubId: 1, orderId: 1, _id: 1 });
ClubFinancialAdjustmentSchema.index({ clubId: 1, notificationPublishedAt: 1, _id: 1 }, {
  partialFilterExpression: { kind: 'member_penalty', status: 'approved' },
});
ClubFinancialAdjustmentSchema.index({ clubId: 1, requestedByUserId: 1, requestId: 1 }, {
  unique: true, partialFilterExpression: { requestId: { $type: 'string' } },
});
ClubFinancialAdjustmentSchema.index({ clubId: 1, kind: 1, status: 1, memberUserId: 1 });
