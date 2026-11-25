import type { ClubPromotionPolicy, CommissionRule, DispatchPricing, PlatformPromotionSource } from "@webapp-template/common";
import type Resp from "@/models/Resp";
import { createAppRequest } from "./request";

const request = createAppRequest("/admin/clubs");

export interface AdminClub {
  id: string;
  name: string;
  permissions: string[];
}

export type DispatchPricingRow = CommissionRule & Partial<Pick<DispatchPricing, "dispatchFeeCents" | "segments" | "giftSegments" | "priceUnit">> & {
  id: string;
  source: "direct_dispatch" | "client_order";
  dispatcherUserId: string;
  publishedAt: string;
};

export async function getAdminClubs() {
  const response: Resp<AdminClub[]> = await request.get("");
  return response.getData() ?? [];
}

export async function getCommissionRule(clubId: string) {
  const response: Resp<CommissionRule | null> = await request.get(`/${clubId}/commission-rule`);
  return response.getData() ?? null;
}

export async function saveCommissionRule(clubId: string, input: { expectedVersion: number; clubFeeCents: number }) {
  const response: Resp<CommissionRule> = await request.patch(`/${clubId}/commission-rule`, input);
  return response.getData() ?? null;
}

export async function getClubPromotions(clubId: string) {
  const response: Resp<ClubPromotionPolicy> = await request.get(`/${clubId}/promotions`);
  return response.getData();
}

export async function saveClubPromotions(clubId: string, input: { expectedVersion: number; activityName?: string; activityPayableBasisPoints?: number }) {
  const response: Resp<ClubPromotionPolicy> = await request.patch(`/${clubId}/promotions`, input);
  return response.getData();
}

export async function issueClubCoupon(clubId: string, input: {
  requestId: string; customerUserId: string; name: string; kind: "rate_coupon" | "threshold_coupon";
  payableBasisPoints?: number; thresholdCents?: number; discountCents?: number;
}) {
  const response: Resp<PlatformPromotionSource> = await request.post(`/${clubId}/promotions/coupons`, input);
  return response.getData();
}

export async function getDispatchHistory(clubId: string, after?: string) {
  const response: Resp<{ items: DispatchPricingRow[]; nextCursor: string | null }> = await request.get(`/${clubId}/dispatch-pricing`, { params: { limit: 5, after } });
  return response.getData() ?? { items: [], nextCursor: null };
}
