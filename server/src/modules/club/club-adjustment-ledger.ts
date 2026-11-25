import type { ClubBalance, ClubBalanceEntry } from '@webapp-template/common';
import type { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import { hasConfirmedAdjustment, hasConfirmedMemberPenalty, penaltyPostedAt, type PostedOrderPenalties } from './club-gift-settlement-adjustments';

// An independent penalty posts at decision. An order-linked penalty posts
// only with the order's committed settlement and the IDs frozen in that record.
export function adjustmentPostings(record: ClubFinancialAdjustment, settlement?: PostedOrderPenalties) {
  const adjustmentId = record._id.toHexString();
  const base = { adjustmentId, orderId: record.orderId?.toHexString(), kind: record.kind, reason: record.reason };
  if (record.kind === 'member_penalty') {
    if (!hasConfirmedMemberPenalty(record)) return [];
    const postedAt = penaltyPostedAt(record, settlement);
    if (!postedAt) return [];
    const event = {
      ...base,
      eventId: `club.penalty:${adjustmentId}`,
      occurredAt: postedAt.toISOString(),
    };
    return [
      { ...event, memberUserId: record.memberUserId, amountCents: -record.amountCents },
      { ...event, memberUserId: null, amountCents: record.amountCents },
    ];
  }
  if (!hasConfirmedAdjustment(record)) return [];
  return (record.refunds ?? []).map(refund => ({
    ...base,
    eventId: `club.compensation.refund:${adjustmentId}:${refund.requestId}`,
    occurredAt: refund.occurredAt.toISOString(),
    memberUserId: null,
    amountCents: -refund.amountCents,
  }));
}

export function adjustmentBalance(records: readonly ClubFinancialAdjustment[], memberUserId: string | null, includeOrder: boolean,
  settlements: ReadonlyMap<string, PostedOrderPenalties>): ClubBalance {
  const entries: ClubBalanceEntry[] = [];
  let balance = 0n;
  for (const record of records) {
    const settlement = record.orderId ? settlements.get(record.orderId.toHexString()) : undefined;
    for (const { memberUserId: account, orderId, ...data } of adjustmentPostings(record, settlement)) {
      if (account !== memberUserId) continue;
      entries.push({ ...data, ...(includeOrder && orderId ? { orderId } : {}) });
      balance += BigInt(data.amountCents);
    }
  }
  if (!Number.isSafeInteger(Number(balance))) throw new RangeError('余额超出安全整数范围');
  entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.eventId.localeCompare(b.eventId));
  return { balanceCents: Number(balance), entries };
}
