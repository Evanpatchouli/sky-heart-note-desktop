import { USER_ID_PATTERN, type GiftSettlementAdjustment, type GiftSettlementIssue, type PersonalGiftPenalty } from '@webapp-template/common';
import type { ClubFinancialAdjustment } from './club-financial-adjustment.schema';

type AdjustmentDecision = Pick<GiftSettlementAdjustment, 'status' | 'amountCents' | 'decidedByUserId'> & {
  decidedAt?: Date | string;
};
type PenaltyDecision = AdjustmentDecision & Pick<GiftSettlementAdjustment, 'kind' | 'memberUserId' | 'requestedByUserId'> & {
  refunds?: readonly unknown[];
};

function hasConfirmedAdjustment(record: AdjustmentDecision) {
  return record.status === 'approved' && !!record.decidedByUserId && !!record.decidedAt &&
    Number.isSafeInteger(record.amountCents) && record.amountCents > 0;
}

function isUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_PATTERN.test(value);
}

export function hasConfirmedMemberPenalty<T extends PenaltyDecision>(
  record: T,
): record is T & { memberUserId: string; decidedAt: NonNullable<T['decidedAt']> } {
  const { decidedAt, refunds } = record;
  const decidedTime = decidedAt instanceof Date ? decidedAt.getTime()
    : typeof decidedAt === 'string' ? Date.parse(decidedAt) : NaN;
  return record.kind === 'member_penalty' && hasConfirmedAdjustment(record) &&
    isUserId(record.decidedByUserId) && Number.isFinite(decidedTime) &&
    isUserId(record.memberUserId) && isUserId(record.requestedByUserId) &&
    (refunds == null || Array.isArray(refunds) && refunds.length === 0);
}

export function personalPenalty({ id, amountCents, reason, decidedAt }: GiftSettlementAdjustment): PersonalGiftPenalty {
  return { id, amountCents, reason, decidedAt };
}

export function giftSettlementAdjustments(
  records: readonly ClubFinancialAdjustment[], issues: Set<GiftSettlementIssue>, existingRefunds: readonly { requestId: string }[] = [],
) {
  const adjustments: GiftSettlementAdjustment[] = [];
  const penalties = new Map<string, { sum: bigint; items: PersonalGiftPenalty[] }>();
  const paymentIds = new Set(existingRefunds.map(payment => payment.requestId));
  let penaltyCents = 0n;
  let due = 0n;
  let paid = 0n;
  let remaining = 0n;
  let excess = 0n;

  for (const record of records) {
    const { _id, kind, status, revision, amountCents, reason, requestedByUserId,
      createdAt, decidedByUserId, decidedAt, memberUserId, refunds } = record;
    const row: GiftSettlementAdjustment = {
      id: _id.toHexString(), kind, status, revision, amountCents, reason, requestedByUserId, createdAt: createdAt.toISOString(),
      ...(decidedByUserId ? { decidedByUserId } : {}),
      ...(decidedAt instanceof Date && Number.isFinite(decidedAt.getTime()) ? { decidedAt: decidedAt.toISOString() } : {}),
      ...(memberUserId ? { memberUserId } : {}),
      refunds: (Array.isArray(refunds) ? refunds : []).map(payment => ({
        ...payment, occurredAt: payment.occurredAt.toISOString(), recordedAt: payment.recordedAt.toISOString(),
      })),
    };
    adjustments.push(row);
    if (row.status !== 'approved') continue;
    if (!(kind === 'member_penalty' ? hasConfirmedMemberPenalty(record) && !!row.decidedAt : hasConfirmedAdjustment(row))) {
      issues.add('adjustment_invalid');
      continue;
    }
    const amount = BigInt(row.amountCents);
    if (kind === 'member_penalty' && memberUserId) {
      const found = penalties.get(memberUserId) ?? { sum: 0n, items: [] };
      found.sum += amount;
      found.items.push(personalPenalty(row));
      penalties.set(memberUserId, found);
      penaltyCents += amount;
      continue;
    }
    let actual = 0n;
    for (const payment of row.refunds) {
      if (!payment.requestId || !payment.recordedByUserId || paymentIds.has(payment.requestId) ||
        !Number.isSafeInteger(payment.amountCents) || payment.amountCents < 1) {
        issues.add('adjustment_invalid');
        continue;
      }
      paymentIds.add(payment.requestId);
      actual += BigInt(payment.amountCents);
    }
    due += amount;
    paid += actual;
    if (amount >= actual) remaining += amount - actual;
    else excess += actual - amount;
  }
  return { adjustments, penalties, penaltyCents, compensation: { due, paid, remaining, excess } };
}
