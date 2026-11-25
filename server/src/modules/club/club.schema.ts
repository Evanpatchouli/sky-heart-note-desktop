import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';
import type { ClubPromotionPolicy, CommissionRule } from '@sky-club/common';
import { SchemaTypes } from 'mongoose';
import { CLUB_PERMISSIONS, type ClubPermission } from './club-permissions';
import { CommissionRuleSchema } from './club-pricing.schema';

export const CLUB_ID = 'club';
export const CLUB_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const CLUB_LEADERSHIP_POSITIONS = ['leader', 'deputy'] as const;
export const CLUB_MEMBER_POSITIONS = ['member', ...CLUB_LEADERSHIP_POSITIONS] as const;
export type ClubMemberPosition = (typeof CLUB_MEMBER_POSITIONS)[number];

@Schema({ collection: 'clubs', timestamps: true, versionKey: false })
export class Club {
  @Prop({ type: String, required: true, enum: [CLUB_ID] })
  _id: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name: string;

  @Prop({ type: CommissionRuleSchema })
  commissionRule?: CommissionRule;

  @Prop({ type: SchemaTypes.Mixed })
  promotionPolicy?: ClubPromotionPolicy;
}

export const ClubSchema = SchemaFactory.createForClass(Club);

@Schema({ collection: 'club_members', timestamps: true, versionKey: false })
export class ClubMember {
  @Prop({
    type: String,
    required: true,
    match: CLUB_ID_PATTERN,
    immutable: true,
  })
  clubId: string;

  @Prop({
    type: String,
    required: true,
    match: USER_ID_PATTERN,
    immutable: true,
  })
  userId: string;

  @Prop({ type: Boolean, required: true })
  active: boolean;

  @Prop({ type: Boolean, required: true })
  dispatcher: boolean;

  @Prop({ type: String, enum: CLUB_MEMBER_POSITIONS })
  position?: ClubMemberPosition;

  @Prop({ type: [String], enum: CLUB_PERMISSIONS, default: [] })
  permissions: ClubPermission[];
}

export const ClubMemberSchema = SchemaFactory.createForClass(ClubMember);
ClubMemberSchema.index({ clubId: 1, userId: 1 }, { unique: true });
ClubMemberSchema.index(
  { clubId: 1, position: 1 },
  { unique: true, partialFilterExpression: { position: 'leader' } },
);
ClubMemberSchema.index({ clubId: 1, active: 1, dispatcher: 1 });
ClubMemberSchema.index({ userId: 1, active: 1 });
