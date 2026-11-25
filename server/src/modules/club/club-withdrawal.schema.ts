import { Schema, type Types } from 'mongoose';

export const CLUB_WITHDRAWAL_EVENT_MODEL = 'ClubWithdrawalEvent';

export type ClubWithdrawalMovement = {
  withdrawalId: Types.ObjectId;
  actorUserId: string;
  occurredAt: Date;
} & (
  { kind: 'request'; requestId: string; amountCents: number } |
  { kind: 'payment'; requestId: string; amountCents: number; transferReference?: string } |
  { kind: 'approved' | 'rejected' }
);

export type ClubWithdrawalEvent = ClubWithdrawalMovement & {
  clubId: string;
  memberUserId: string;
  sequence: number;
};

export const ClubWithdrawalEventSchema: Schema<ClubWithdrawalEvent> = new Schema({
  clubId: { type: String, required: true },
  memberUserId: { type: String, required: true },
  sequence: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  withdrawalId: { type: Schema.Types.ObjectId, required: true },
  actorUserId: { type: String, required: true },
  occurredAt: { type: Date, required: true },
  kind: { type: String, required: true, enum: ['request', 'approved', 'rejected', 'payment'] },
  requestId: { type: String, required: hasAmount },
  amountCents: { type: Number, required: hasAmount, min: 1, validate: Number.isSafeInteger },
  transferReference: { type: String, maxlength: 240 },
}, { collection: 'club_withdrawal_events', versionKey: false });

ClubWithdrawalEventSchema.index({ clubId: 1, memberUserId: 1, sequence: 1 }, { unique: true });
ClubWithdrawalEventSchema.index({ clubId: 1, kind: 1, requestId: 1 }, {
  unique: true, partialFilterExpression: { kind: 'payment' },
});

function hasAmount(this: Pick<ClubWithdrawalEvent, 'kind'>) {
  return this.kind === 'request' || this.kind === 'payment';
}
