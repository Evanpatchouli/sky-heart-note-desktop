import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';
import { Types } from 'mongoose';
import { OBSERVED_PERIODS, type ObservedPeriod } from './club-delivery.dto';

export const REPORT_CHECKS = ['unmatched_period', 'quantity_mismatch'] as const;
export type ReportCheck = (typeof REPORT_CHECKS)[number];

const nonnegative = {
  type: Number,
  required: true,
  min: 0,
  validate: Number.isSafeInteger,
};

@Schema({ _id: false })
export class DailyReportLine {
  @Prop({ type: Types.ObjectId })
  shareId?: Types.ObjectId;

  @Prop({ type: String, enum: OBSERVED_PERIODS, required: true })
  period: ObservedPeriod;

  @Prop({ ...nonnegative, required: false, min: 1 })
  quoteSegment?: number;

  @Prop({ type: [Number], default: undefined })
  promotionPaidSegmentIndices?: number[];

  @Prop(nonnegative)
  giftTimes: number;

  @Prop({ ...nonnegative, required: false })
  receivedHearts: number | null;
}

@Schema({ collection: 'club_daily_reports', versionKey: false })
export class DailyReport {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: ['gift_times'] })
  priceUnit?: 'gift_times';

  @Prop({ type: String })
  clubId?: string;

  @Prop({ type: Types.ObjectId, required: true })
  orderId: Types.ObjectId;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  userId: string;

  @Prop({ type: Types.ObjectId, required: true })
  shareId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  accountId: Types.ObjectId;

  @Prop({ type: String, required: true })
  accountName: string;

  @Prop({ type: String })
  accountLocalId?: string;

  @Prop({ type: String })
  personalAccountId?: string;

  @Prop({ type: String })
  memberNickname?: string | null;

  @Prop({ type: String, required: true })
  recipientGameAccount: string;

  @Prop({ type: String, required: true })
  businessDate: string;

  @Prop({ type: Date, required: true })
  submittedAt: Date;

  @Prop({
    type: String,
    enum: ['daily', 'supplement', 'correction'],
    required: true,
  })
  kind: 'daily' | 'supplement' | 'correction';

  @Prop({ ...nonnegative, min: 1 })
  version: number;

  @Prop({ type: Types.ObjectId, required: true })
  originalId: Types.ObjectId;

  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({ type: String, required: true })
  requestHash: string;

  @Prop({ type: String, maxlength: 240 })
  reason?: string;

  @Prop({
    type: [SchemaFactory.createForClass(DailyReportLine)],
    required: true,
  })
  lines: DailyReportLine[];

  @Prop({ ...nonnegative, required: false })
  receivedHearts: number | null;

  @Prop({ type: [String], enum: REPORT_CHECKS, default: undefined })
  checks?: ReportCheck[];
}

export const DailyReportSchema = SchemaFactory.createForClass(DailyReport);

DailyReportSchema.index(
  { orderId: 1, userId: 1, requestId: 1 },
  { unique: true },
);
DailyReportSchema.index(
  { orderId: 1, userId: 1, accountId: 1, businessDate: 1 },
  {
    unique: true,
    partialFilterExpression: { version: 1 },
  },
);
DailyReportSchema.index({ originalId: 1, version: -1 }, { unique: true });
DailyReportSchema.index({ orderId: 1, kind: 1, shareId: 1 });
DailyReportSchema.index({ orderId: 1, userId: 1, _id: -1 });
