import { ConflictException } from '@nestjs/common';
import { clubSettlementPostingLabel, type ClubBalanceEntry, type ClubSettlementPostingKind,
  type GiftSettlementCalculation, type GiftSettlementClose } from '@webapp-template/common';
import type { ClubOrder } from './club-order.schema';
import type { StoredSettlementCorrection } from './club-settlement-correction.service';
import type { SettlementCorrection, SettlementCorrectionCouponChange } from '@webapp-template/common';

export type OrderSettlementPosting = {
  kind: ClubSettlementPostingKind;
  memberUserId: string | null;
  amountCents: number;
};

export type StoredSettlementClose = GiftSettlementClose & { postings: OrderSettlementPosting[] };

export function closeView(close?: StoredSettlementClose): GiftSettlementClose | undefined {
  if (!close) return undefined;
  const { postings: _postings, ...view } = close;
  return view;
}

export function correctionView({ requestHash: _hash, proposedReport: _proposal, couponChange: _coupon, ...row }: StoredSettlementCorrection): SettlementCorrection {
  return row;
}

export function financeCorrectionView(row: StoredSettlementCorrection) {
  return { ...correctionView(row), ...(row.kind === 'daily_report' && row.couponChange ? { couponChange: row.couponChange } : {}) };
}

export function settlementCouponChange(
  order: ClubOrder, before: GiftSettlementCalculation, after: GiftSettlementCalculation, changedAt: string,
): SettlementCorrectionCouponChange | undefined {
  const couponId = order.receipt?.quote.promotions?.platform?.couponId;
  if (!couponId || !before.stopped) return undefined;
  const wasZero = BigInt(before.observedGiftTimes) === 0n;
  const isZero = BigInt(after.observedGiftTimes) === 0n;
  if (wasZero && !isZero && order.promotionCouponReturnedAt) {
    return { couponId, status: 'used', changedAt, previousReturnedAt: order.promotionCouponReturnedAt };
  }
  if (!wasZero && isZero && order.activePromotionCouponId === couponId) {
    return { couponId, status: 'returned', changedAt };
  }
}

export function revisedCouponState(change?: SettlementCorrectionCouponChange): Pick<ClubOrder, 'activePromotionCouponId' | 'promotionCouponReturnedAt'> {
  if (!change) return {};
  return change.status === 'used'
    ? { activePromotionCouponId: change.couponId, promotionCouponReturnedAt: undefined }
    : { activePromotionCouponId: undefined, promotionCouponReturnedAt: change.changedAt };
}

export function settlementPostings(calculation: GiftSettlementCalculation) {
  const postings: OrderSettlementPosting[] = [];
  const { totals, dispatcherUserId } = calculation;
  const append = (kind: ClubSettlementPostingKind, memberUserId: string | null, amountCents: number | null) => {
    if (amountCents === null || !Number.isSafeInteger(amountCents))
      throw new ConflictException('结算金额无效，请重新核对');
    if (amountCents) postings.push({ kind, memberUserId, amountCents });
  };
  append('dispatch_fee', dispatcherUserId, totals.dispatchFeeCents ?? 0);
  append('personal_discount', dispatcherUserId, -(totals.personalDiscountCents ?? 0));
  for (const member of calculation.members) append('member_reward', member.userId, member.rewardCents);
  append('club_fee', null, totals.clubFeeCents ?? 0);
  append('platform_discount', null, -(totals.platformDiscountCents ?? 0));
  append('promotional_gift', null, -(totals.promotionalGiftCostCents ?? 0));
  return postings;
}

export function settlementBalanceEntries(order: Pick<ClubOrder, '_id' | 'settlementClose' | 'settlementCorrections'>, memberUserId: string | null): ClubBalanceEntry[] {
  if (!order.settlementClose) return [];
  const { closedAt, calculationId, postings } = order.settlementClose;
  const orderId = order._id.toHexString();
  const original: ClubBalanceEntry[] = postings.filter(posting => posting.memberUserId === memberUserId).map(({ kind, amountCents }) => ({
    eventId: `club.settlement:${orderId}:${kind}:${memberUserId ?? 'club'}`,
    orderId, kind, amountCents, occurredAt: closedAt, calculationId, reason: clubSettlementPostingLabel[kind],
  }));
  const corrections = (order.settlementCorrections ?? []).flatMap<ClubBalanceEntry>(row => {
    if (row.status !== 'approved' || !row.decidedAt) return [];
    if (row.kind === 'cash') {
      return memberUserId === null && row.movement.kind === 'compensation_refund' && row.eventId && row.deltaCents ? [{
        eventId: row.eventId, orderId, kind: 'compensation_cash_correction', amountCents: -row.deltaCents,
        occurredAt: row.decidedAt, calculationId, reason: row.reason,
        correctionRequestId: row.requestId, sourceMovementRequestId: row.movement.requestId,
      }] : [];
    }
    return (row.postings ?? []).filter(posting => posting.memberUserId === memberUserId).map(({ kind, amountCents }) => ({
      eventId: `club.settlement.report:${orderId}:${row.requestId}:${kind}:${memberUserId ?? 'club'}`,
      orderId, kind, amountCents, occurredAt: row.decidedAt!, calculationId, reason: row.reason,
      correctionRequestId: row.requestId, revisedCalculationId: row.revisedCalculationId,
    }));
  });
  return [...original, ...corrections];
}
