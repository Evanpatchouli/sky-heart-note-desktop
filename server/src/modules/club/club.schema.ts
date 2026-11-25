import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@webapp-template/common';
import type { CommissionRule } from '@webapp-template/common';
import { CLUB_PERMISSIONS, type ClubPermission } from './club-permissions';
import { CommissionRuleSchema } from './club-pricing.schema';

export const CLUB_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

@Schema({ collection: 'clubs', timestamps: true, versionKey: false })
export class Club {
  @Prop({ type: String, required: true, match: CLUB_ID_PATTERN })
  _id: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name: string;

  @Prop({ type: CommissionRuleSchema })
  commissionRule?: CommissionRule;
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

  @Prop({ type: [String], enum: CLUB_PERMISSIONS, default: [] })
  permissions: ClubPermission[];
}

export const ClubMemberSchema = SchemaFactory.createForClass(ClubMember);
ClubMemberSchema.index({ clubId: 1, userId: 1 }, { unique: true });
ClubMemberSchema.index({ clubId: 1, active: 1, dispatcher: 1 });
ClubMemberSchema.index({ userId: 1, active: 1 });
