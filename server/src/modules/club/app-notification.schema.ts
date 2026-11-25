import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { apps, type WebApp } from '../../auth/app-access';

export const noticeTypes = ['normal', 'important', 'system'] as const;
export type NoticeType = (typeof noticeTypes)[number];
export type NoticeTarget = 'inbox' | 'client-order-assigned';

@Schema({ collection: 'app_notification_events', versionKey: false })
export class AppNotificationEvent {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  eventKey: string;

  @Prop({ type: String, enum: apps, required: true })
  targetApp: WebApp;

  @Prop({ type: String, enum: noticeTypes, required: true })
  type: NoticeType;

  @Prop({ type: [String], required: true })
  recipientUserIds: string[];

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String })
  body?: string;

  @Prop({ type: String, required: true })
  target: NoticeTarget;

  @Prop({ type: String })
  objectId?: string;

  @Prop({ type: String })
  clubId?: string;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ type: Date })
  nextAttemptAt?: Date;

  @Prop({ type: Date })
  pushNextAttemptAt?: Date;

  @Prop({ type: String })
  pushLease?: string;
}

export const AppNotificationEventSchema = SchemaFactory.createForClass(AppNotificationEvent);
AppNotificationEventSchema.index({ eventKey: 1, targetApp: 1 }, { unique: true });
AppNotificationEventSchema.index({ nextAttemptAt: 1 }, { sparse: true });
AppNotificationEventSchema.index({ pushNextAttemptAt: 1 }, { sparse: true });
