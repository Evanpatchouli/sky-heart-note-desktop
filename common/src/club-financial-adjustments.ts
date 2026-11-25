import type { GiftSettlementAdjustment, PersonalGiftPenalty } from "./club-gift-settlement";

export type ClubAdjustmentKind = GiftSettlementAdjustment["kind"];
export type ClubAdjustmentDecision = Exclude<GiftSettlementAdjustment["status"], "pending">;

export const clubAdjustmentStatusLabel = {
  pending: "待确认", approved: "已生效", rejected: "已驳回",
} satisfies Record<GiftSettlementAdjustment["status"], string>;

export const clubPenaltyPostingLabel = {
  awaiting_close: "随结单扣记", posted: "已入账", not_in_settlement: "未列入本次结单",
} as const;

export type ClubAdjustmentCandidate = { userId: string; nickname: string | null };

export type ClubAdjustmentRecord = GiftSettlementAdjustment & {
  orderId?: string;
  customerUserId?: string;
};

export type ClubAdjustmentList = {
  records: ClubAdjustmentRecord[];
  memberNames: Record<string, string | null>;
};

export type ClubPenaltyList = ClubAdjustmentList & {
  canPublish: boolean;
  candidates: ClubAdjustmentCandidate[];
};

export type OrderAdjustmentList = ClubAdjustmentList & {
  canRequest: boolean;
  canRequestPenalty: boolean;
  candidates: ClubAdjustmentCandidate[];
};

export type RequestClubAdjustment = {
  requestId: string;
  kind: ClubAdjustmentKind;
  memberUserId?: string;
  amountCents: number;
  reason: string;
};

export type PublishClubPenalty = Omit<RequestClubAdjustment, "kind" | "memberUserId"> & {
  memberUserId: string;
  orderId?: string;
};

export type RecordCompensationRefund = {
  requestId: string;
  expectedRevision: number;
  amountCents: number;
  occurredAt: string;
  evidence?: string;
};

export const clubSettlementPostingLabel = {
  dispatch_fee: "派抽原额",
  personal_discount: "个人让利",
  member_reward: "送心报酬",
  club_fee: "团抽原额",
  platform_discount: "平台优惠",
  promotional_gift: "赠送成本",
} as const;

export type ClubSettlementPostingKind = keyof typeof clubSettlementPostingLabel;

export type ClubBalanceEntry = {
  eventId: string;
  orderId?: string;
  amountCents: number;
  occurredAt: string;
  reason: string;
} & (
  { kind: ClubAdjustmentKind; adjustmentId: string } |
  { kind: ClubSettlementPostingKind; calculationId: string; correctionRequestId?: string; revisedCalculationId?: string } |
  { kind: 'compensation_cash_correction'; calculationId: string; correctionRequestId: string; sourceMovementRequestId: string } |
  { kind: 'withdrawal_payment'; withdrawalId: string }
);

export type ClubBalance = { balanceCents: number; entries: ClubBalanceEntry[] };
export type PersonalClubBalance = ClubBalance & {
  pendingPenalties: (PersonalGiftPenalty & { penaltyPosting: "awaiting_close" | "not_in_settlement" })[];
};
