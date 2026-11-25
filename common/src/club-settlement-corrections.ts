import type { ClubSettlementPostingKind } from './club-financial-adjustments';
import type { GiftReportLine } from './club-gift-delivery';

export type SettlementCashMovementKind = 'original_receipt' | 'continuation_receipt' | 'supplement' | 'refund' | 'compensation_refund';
export const settlementCashMovementLabel = {
  original_receipt: '首款实收',
  continuation_receipt: '续段实收',
  supplement: '改价实补',
  refund: '服务款实退',
  compensation_refund: '额外补偿实退',
} satisfies Record<SettlementCashMovementKind, string>;

export interface SettlementCashMovement {
  requestId: string;
  kind: SettlementCashMovementKind;
  originalAmountCents: number;
  effectiveAmountCents: number;
  revision: number;
  occurredAt: string;
}

type CorrectionDecision = {
  decidedAt?: string;
  decidedByUserId?: string;
  decisionReason?: string;
};

export type SettlementReportCorrectionInput = {
  requestId: string;
  expectedVersion: number;
  lines: (Pick<GiftReportLine, 'giftTimes'> & Partial<Omit<GiftReportLine, 'giftTimes'>>)[];
  reason: string;
};

export type SettlementCashCorrectionInput = {
  requestId: string;
  movementRequestId: string;
  movementKind?: SettlementCashMovementKind;
  expectedRevision: number;
  correctedAmountCents: number;
  evidence: string;
  reason: string;
};

export type SettlementCorrectionCouponChange = {
  couponId: string;
  status: 'used' | 'returned';
  changedAt: string;
  previousReturnedAt?: string;
};

export type SettlementCorrection = CorrectionDecision & {
  requestId: string;
  orderId: string;
  calculationId: string;
  requestedByUserId: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
} & (
  {
    kind: 'daily_report';
    originalReportId: string;
    priorReportId: string;
    expectedVersion: number;
    businessDate: string;
    previousLines: GiftReportLine[];
    lines: GiftReportLine[];
    approvedReportId?: string;
    approvedVersion?: number;
    revisedCalculationId?: string;
    couponChange?: SettlementCorrectionCouponChange;
    postings?: { kind: ClubSettlementPostingKind; memberUserId: string | null; amountCents: number }[];
  } |
  {
    kind: 'cash';
    movement: SettlementCashMovement;
    correctedAmountCents: number;
    evidence: string;
    deltaCents?: number;
    eventId?: string;
  }
);
