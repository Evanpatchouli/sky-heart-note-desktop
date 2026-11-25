import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { apps, type WebApp } from '../../auth/app-access';
import { noticeTypes, type NoticeTarget, type NoticeType } from './app-notification.schema';
import { CLUB_ID_PATTERN } from './club.schema';

@Schema({ _id: false })
export class DispatchPublication {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  id: Types.ObjectId;

  @Prop({ type: String, required: true, match: CLUB_ID_PATTERN })
  clubId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orderId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  publishedAt: Date;

  @Prop({ type: [{ type: String, match: USER_ID_PATTERN }], required: true })
  recipientUserIds: string[];

  @Prop({ type: Boolean, required: true })
  pending: boolean;

  @Prop({ type: Date, required: true })
  nextAttemptAt: Date;

  @Prop({ type: Date })
  deliveredAt?: Date;

  @Prop({ type: Date })
  pushNextAttemptAt?: Date;

  @Prop({ type: String })
  pushLease?: string;
}

export const DispatchPublicationSchema =
  SchemaFactory.createForClass(DispatchPublication);

@Schema({ collection: 'club_dispatch_notices', versionKey: false })
export class ClubDispatchNotice {
  _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  publicationId: Types.ObjectId;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  recipientUserId: string;

  @Prop({ type: String, match: CLUB_ID_PATTERN })
  clubId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  orderId?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  publishedAt: Date;

  @Prop({ type: String, enum: noticeTypes, required: true })
  type: NoticeType;

  @Prop({ type: String, enum: apps, required: true })
  targetApp: WebApp;

  @Prop({ type: String })
  eventKey?: string;

  @Prop({ type: String })
  target?: NoticeTarget;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: String })
  body?: string;

  @Prop({ type: Date, default: null })
  readAt: Date | null;
}

export const ClubDispatchNoticeSchema =
  SchemaFactory.createForClass(ClubDispatchNotice);

ClubDispatchNoticeSchema.index(
  { publicationId: 1, recipientUserId: 1 },
  { unique: true },
);
ClubDispatchNoticeSchema.index({ recipientUserId: 1, publicationId: -1 });
ClubDispatchNoticeSchema.index({ targetApp: 1, recipientUserId: 1, _id: -1 });
ClubDispatchNoticeSchema.index(
  { recipientUserId: 1, clubId: 1 },
  { partialFilterExpression: { readAt: null } },
);
