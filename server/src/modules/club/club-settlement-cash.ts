import { ConflictException } from '@nestjs/common';
import type { GiftSettlementAdjustment, GiftSettlementCalculation, GiftSettlementIssue, SettlementCashMovement, SettlementCashMovementKind } from '@sky-club/common';
import type { ClubOrder } from './club-order.schema';

const cashCategories = {
  original_receipt: 'originalReceivedCents',
  continuation_receipt: 'continuationReceivedCents',
  supplement: 'supplementReceivedCents',
  refund: 'refundedCents',
  compensation_refund: 'compensationRefundedCents',
} as const;
type CashCategory = (typeof cashCategories)[SettlementCashMovementKind];

export function cashMovements(order: ClubOrder, adjustments: readonly GiftSettlementAdjustment[] = []) {
  const movements = new Map<string, SettlementCashMovement>();
  const add = (kind: SettlementCashMovementKind, requestId: string, amount: number, occurredAt: string) => {
    movements.set(`${kind}:${requestId}`, { requestId, kind, originalAmountCents: amount, effectiveAmountCents: amount, revision: 1, occurredAt });
  };
  const { receipt } = order;
  if (receipt) add('original_receipt', receipt.requestId, receipt.receivedAmountCents, receipt.receivedAt.toISOString());
  for (const quote of order.continuationQuotes ?? []) {
    const payment = quote.receipt;
    if (payment) add('continuation_receipt', payment.requestId, payment.receivedAmountCents, payment.receivedAt.toISOString());
  }
  for (const contract of order.giftPriceAdjustments ?? []) {
    for (const payment of contract.payments) add(payment.kind, payment.requestId, payment.amountCents, payment.occurredAt);
  }
  for (const payment of order.giftTermination?.refunds ?? []) add('refund', payment.requestId, payment.amountCents, payment.occurredAt);
  for (const adjustment of adjustments) {
    if (adjustment.kind !== 'customer_compensation' || adjustment.status !== 'approved') continue;
    for (const payment of adjustment.refunds)
      add('compensation_refund', payment.requestId, payment.amountCents, payment.occurredAt);
  }
  for (const correction of order.settlementCorrections ?? []) {
    if (correction.kind !== 'cash' || correction.status !== 'approved') continue;
    const movement = movements.get(`${correction.movement.kind}:${correction.movement.requestId}`);
    if (movement) {
      movement.effectiveAmountCents = correction.correctedAmountCents;
      movement.revision++;
    }
  }
  return [...movements.values()];
}

export function effectiveSettlementCash(order: ClubOrder, calculation: GiftSettlementCalculation): GiftSettlementCalculation {
  if (!calculation.cash || !order.settlementCorrections?.some(row => row.kind === 'cash' && row.status === 'approved'))
    return calculation;
  const cash = { ...calculation.cash };
  const movements = cashMovements(order, calculation.adjustments);
  const amounts = new Map<string, number>();
  const differences = new Map<CashCategory, bigint>();
  for (const movement of movements) {
    const delta = BigInt(movement.effectiveAmountCents) - BigInt(movement.originalAmountCents);
    if (!delta) continue;
    const category = cashCategories[movement.kind];
    differences.set(category, (differences.get(category) ?? 0n) + delta);
    if (category === 'compensationRefundedCents') differences.set('refundedCents', (differences.get('refundedCents') ?? 0n) + delta);
    if (movement.kind === 'refund') amounts.set(movement.requestId, movement.effectiveAmountCents);
  }
  for (const [category, difference] of differences) cash[category] = safeMoney(BigInt(cash[category] ?? 0) + difference);
  const gross = BigInt(cash.originalReceivedCents) + BigInt(cash.continuationReceivedCents) + BigInt(cash.supplementReceivedCents);
  cash.netReceivedCents = safeMoney(gross - BigInt(cash.refundedCents ?? 0));
  const teamCorrection = -(differences.get('compensationRefundedCents') ?? 0n);
  const totals = { ...calculation.totals };
  if (teamCorrection) {
    totals.compensationCashCorrectionCents = safeMoney(teamCorrection);
    if (totals.clubNetCents !== null) totals.clubNetCents = safeMoney(BigInt(totals.clubNetCents) + teamCorrection);
    if (totals.allocatedCents !== null) totals.allocatedCents = safeMoney(BigInt(totals.allocatedCents) + teamCorrection);
  }
  totals.differenceCents = totals.allocatedCents === null ? null : safeMoney(BigInt(cash.netReceivedCents) - BigInt(totals.allocatedCents));
  const compensationRefundRemainingCents = Math.max(0, (cash.compensationRefundDueCents ?? 0) - (cash.compensationRefundedCents ?? 0));
  const serviceRefunded = (cash.refundedCents ?? 0) - (cash.compensationRefundedCents ?? 0);
  const serviceDue = (cash.refundDueCents ?? 0) - (cash.compensationRefundDueCents ?? 0);
  cash.refundRemainingCents = safeMoney(BigInt(Math.max(0, serviceDue - serviceRefunded)) + BigInt(compensationRefundRemainingCents));
  cash.excessRefundCents = safeMoney(BigInt(Math.max(0, serviceRefunded - serviceDue)) +
    BigInt(Math.max(0, (cash.compensationRefundedCents ?? 0) - (cash.compensationRefundDueCents ?? 0))));
  if (cash.compensationRefundRemainingCents !== undefined) cash.compensationRefundRemainingCents = compensationRefundRemainingCents;
  const stop = calculation.termination;
  const termination = stop ? {
    ...stop, originalReceivedCents: cash.originalReceivedCents, continuationReceivedCents: cash.continuationReceivedCents,
    supplementReceivedCents: cash.supplementReceivedCents, refundedCents: serviceRefunded,
    refundRemainingCents: Math.max(0, serviceDue - serviceRefunded), excessRefundCents: Math.max(0, serviceRefunded - serviceDue),
    netReceivedCents: safeMoney(gross - BigInt(serviceRefunded)),
    refunds: stop.refunds.map(row => ({ ...row, amountCents: amounts.get(row.requestId) ?? row.amountCents })),
  } : null;
  const issues: GiftSettlementIssue[] = calculation.issues.filter(value => value !== 'unreconciled' && value !== 'refund_pending');
  if (totals.differenceCents) issues.push('unreconciled');
  if (cash.refundRemainingCents || cash.excessRefundCents) issues.push('refund_pending');
  return { ...calculation, cash, termination, totals, issues };
}

function safeMoney(amount: bigint) {
  const cents = Number(amount);
  if (!Number.isSafeInteger(cents)) throw new ConflictException('更正后的金额超出安全整数范围');
  return cents;
}
