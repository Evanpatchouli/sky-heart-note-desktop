import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { apps, type WebApp } from '../../auth/app-access';

@Schema({ collection: 'club_dispatch_push_subscriptions', versionKey: false })
export class ClubDispatchPushSubscription {
  _id: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true, unique: true })
  sessionId: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: String, enum: apps })
  targetApp?: WebApp;

  @Prop({ required: true })
  accessHash: string;

  @Prop({ required: true, unique: true })
  endpointHash: string;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ required: true })
  p256dh: string;

  @Prop({ required: true })
  auth: string;

  @Prop({ required: true })
  fingerprint: string;

  @Prop({ required: true })
  publicKey: string;

  @Prop({ required: true })
  generation: string;

  @Prop({ required: true })
  boundAt: Date;

  @Prop({ type: Date })
  retryNotBefore?: Date;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export const ClubDispatchPushSubscriptionSchema = SchemaFactory.createForClass(ClubDispatchPushSubscription);
ClubDispatchPushSubscriptionSchema.index({ userId: 1, boundAt: 1 });
ClubDispatchPushSubscriptionSchema.index({ targetApp: 1, userId: 1, boundAt: 1 });

export type PushState = 'pending' | 'accepted' | 'cancelled' | 'failed' | 'expired';

@Schema({ collection: 'club_dispatch_push_deliveries', versionKey: false })
export class ClubDispatchPushDelivery {
  _id: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  publicationId: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  subscriptionId: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  noticeId: Types.ObjectId;

  @Prop({ required: true })
  generation: string;

  @Prop({ type: String })
  clubId?: string;

  @Prop({ type: String, enum: apps })
  targetApp?: WebApp;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: String, required: true })
  state: PushState;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: true })
  nextAttemptAt: Date;

  @Prop({ required: true })
  attempts: number;

  @Prop({ type: String })
  lease?: string;
}

export const ClubDispatchPushDeliverySchema = SchemaFactory.createForClass(ClubDispatchPushDelivery);
ClubDispatchPushDeliverySchema.index({ publicationId: 1, subscriptionId: 1 }, { unique: true });
ClubDispatchPushDeliverySchema.index({ nextAttemptAt: 1 }, { partialFilterExpression: { state: 'pending' } });
ClubDispatchPushDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
