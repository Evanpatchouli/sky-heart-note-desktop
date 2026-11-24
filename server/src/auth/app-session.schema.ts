import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@webapp-template/common';
import { apps, type WebApp } from './app-access';

@Schema({ collection: 'app_sessions', versionKey: false })
export class AppSession {
  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  userId: string;

  @Prop({ type: String, enum: apps, required: true })
  app: WebApp;

  @Prop({ required: true, unique: true })
  accessHash: string;

  @Prop({ required: true, unique: true })
  shareHash: string;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export const AppSessionSchema = SchemaFactory.createForClass(AppSession);
