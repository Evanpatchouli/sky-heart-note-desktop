import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ versionKey: false, collection: 'captcha_challenges' })
export class CaptchaChallenge {
  @Prop({ required: true, unique: true })
  challenge: string;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;

  @Prop({ required: true })
  answer: string;
}

export const CaptchaSchema = SchemaFactory.createForClass(CaptchaChallenge);
