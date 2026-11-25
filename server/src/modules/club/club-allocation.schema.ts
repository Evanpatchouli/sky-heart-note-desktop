import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { USER_ID_PATTERN } from '@sky-club/common';

@Schema({ _id: false })
export class DirectedShare {
  @Prop({ type: String, required: true, match: USER_ID_PATTERN })
  userId: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: Number.isSafeInteger,
  })
  hearts: number;
}

@Schema({ _id: false })
export class DispatchAllocation {
  @Prop({ type: String, required: true })
  requestId: string;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  })
  publicHearts: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  })
  publicRemainingHearts: number;

  @Prop({ type: [SchemaFactory.createForClass(DirectedShare)], required: true })
  directed: DirectedShare[];
}

export const DispatchAllocationSchema =
  SchemaFactory.createForClass(DispatchAllocation);
