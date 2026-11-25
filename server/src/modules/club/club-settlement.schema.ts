import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'club_settlement_calculations', versionKey: false })
export class ClubSettlementCalculation {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, immutable: true })
  clubId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    immutable: true,
  })
  orderId: Types.ObjectId;

  @Prop({ type: Number, required: true, immutable: true })
  version: number;

  @Prop({ type: Date, required: true, immutable: true })
  calculatedAt: Date;

  @Prop({ type: Number, required: true, immutable: true })
  chunkCount: number;
}

export const ClubSettlementCalculationSchema = SchemaFactory.createForClass(
  ClubSettlementCalculation,
);

ClubSettlementCalculationSchema.index({
  clubId: 1,
  orderId: 1,
  calculatedAt: -1,
  _id: -1,
});

@Schema({ collection: 'club_settlement_evidence', versionKey: false })
export class ClubSettlementEvidence {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, immutable: true })
  calculationId: string;

  @Prop({ type: Number, required: true, immutable: true })
  sequence: number;

  @Prop({ type: Buffer, required: true, immutable: true })
  bytes: Buffer;
}

export const ClubSettlementEvidenceSchema = SchemaFactory.createForClass(
  ClubSettlementEvidence,
);

ClubSettlementEvidenceSchema.index({ calculationId: 1, sequence: 1 });
