import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClubBalanceEntry, ClubWithdrawal } from '@sky-club/common';
import type { Model, Types } from 'mongoose';
import { isDuplicateKey } from '../user-module/user-id';
import { CLUB_WITHDRAWAL_EVENT_MODEL, type ClubWithdrawalEvent, type ClubWithdrawalMovement } from './club-withdrawal.schema';
import { CLUB_ID } from './club.schema';

@Injectable()
export class ClubWithdrawalStore implements OnModuleInit {
  constructor(@InjectModel(CLUB_WITHDRAWAL_EVENT_MODEL) private readonly events: Model<ClubWithdrawalEvent>) {}

  async onModuleInit() {
    await this.events.init();
  }

  history(memberUserId?: string) {
    return this.events.find({ clubId: CLUB_ID, ...(memberUserId === undefined ? {} : { memberUserId }) })
      .sort({ memberUserId: 1, sequence: 1 }).readConcern('majority').lean();
  }

  requestedWithdrawal(id: Types.ObjectId) {
    return this.events.findOne({ _id: id, clubId: CLUB_ID, kind: 'request' }).readConcern('majority').lean();
  }

  findPayment(requestId: string) {
    return this.events.findOne({ clubId: CLUB_ID, kind: 'payment', requestId }).readConcern('majority').lean();
  }

  // The unique member sequence makes the append conditional on the complete
  // history used to authorize it. A competing write forces a fresh projection.
  async append(memberUserId: string, sequence: number, movement: ClubWithdrawalMovement) {
    const event: ClubWithdrawalEvent = { ...movement, clubId: CLUB_ID, memberUserId, sequence };
    try {
      await new this.events({ ...event, ...(event.kind === 'request' ? { _id: event.withdrawalId } : {}) })
        .save({ w: 'majority', j: true });
      return event;
    } catch (error) {
      if (isDuplicateKey(error, 'sequence') || isDuplicateKey(error, 'requestId')) return null;
      throw error;
    }
  }

  async balanceEntries(memberUserId: string): Promise<ClubBalanceEntry[]> {
    const payments = await this.events.find({ clubId: CLUB_ID, memberUserId, kind: 'payment' })
      .readConcern('majority').lean();
    return payments.flatMap(event => event.kind === 'payment' ? [{
      eventId: `club.withdrawal.payment:${event.requestId}`,
      withdrawalId: event.withdrawalId.toHexString(),
      kind: 'withdrawal_payment',
      amountCents: -event.amountCents,
      occurredAt: event.occurredAt.toISOString(),
      reason: '提现实付',
    }] : []);
  }
}

export function projectWithdrawals(events: readonly ClubWithdrawalEvent[]) {
  const items = new Map<string, ClubWithdrawal>();
  for (const event of events) applyWithdrawalEvent(items, event);
  return items;
}

export function applyWithdrawalEvent(items: Map<string, ClubWithdrawal>, event: ClubWithdrawalEvent): ClubWithdrawal {
  const id = event.withdrawalId.toHexString();
  const occurredAt = event.occurredAt.toISOString();
  if (event.kind === 'request') {
    const item: ClubWithdrawal = {
      id, requestId: event.requestId, memberUserId: event.memberUserId, requestedAt: occurredAt,
      amountCents: event.amountCents, status: 'pending', payments: [],
    };
    items.set(id, item);
    return item;
  }

  const item = items.get(id);
  if (!item) throw new Error(`提现事件缺少申请记录 ${id}`);
  if (event.kind === 'payment') {
    const { requestId, amountCents, actorUserId, transferReference } = event;
    item.payments.push({
      requestId, amountCents, occurredAt, recordedByUserId: actorUserId,
      ...(transferReference === undefined ? {} : { transferReference }),
    });
    if (remainingWithdrawalCents(item) === 0) item.status = 'paid';
  } else {
    item.status = event.kind;
    item.decidedAt = occurredAt;
    item.decidedByUserId = event.actorUserId;
  }
  return item;
}

export function remainingWithdrawalCents(item: ClubWithdrawal) {
  return item.payments.reduce((remaining, payment) => remaining - payment.amountCents, item.amountCents);
}
