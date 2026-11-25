import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN, type PlatformPromotionTerms } from '@webapp-template/common';
import { SchemaTypes } from 'mongoose';

@Schema({ collection: 'club_promotion_coupons', timestamps: { updatedAt: false }, versionKey: false })
export class ClubPromotionCoupon {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  clubId: string;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  customerUserId: string;

  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  issuedByUserId: string;

  @Prop({ type: String, required: true, maxlength: 80 })
  name: string;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  terms: PlatformPromotionTerms;
}

export const ClubPromotionCouponSchema = SchemaFactory.createForClass(ClubPromotionCoupon);
ClubPromotionCouponSchema.index({ clubId: 1, customerUserId: 1 });
