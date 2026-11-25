import type { AdminGiftSettlement, ClubPromotionPolicy, CommissionRule, DispatchPricing, GiftSettlementRow, PlatformPromotionSource } from "@webapp-template/common";
import type Resp from "@/models/Resp";
import { createAppRequest } from "./request";

const request = createAppRequest("/admin/club");

export interface AdminClub {
  name: string;
  permissions: string[];
}

export type DispatchPricingRow = CommissionRule & Partial<Pick<DispatchPricing, "dispatchFeeCents" | "segments" | "giftSegments" | "priceUnit">> & {
  id: string;
  source: "direct_dispatch" | "client_order";
  dispatcherUserId: string;
  publishedAt: string;
};

export async function getAdminClub() {
  const response: Resp<AdminClub> = await request.get("");
  return response.getData();
}

export async function getCommissionRule() {
  const response: Resp<CommissionRule | null> = await request.get("/commission-rule");
  return response.getData() ?? null;
}

export async function saveCommissionRule(input: { expectedVersion: number; clubFeeCents: number }) {
  const response: Resp<CommissionRule> = await request.patch("/commission-rule", input);
  return response.getData() ?? null;
}

export async function getClubPromotions() {
  const response: Resp<ClubPromotionPolicy> = await request.get("/promotions");
  return response.getData();
}

export async function saveClubPromotions(input: { expectedVersion: number; activityName?: string; activityPayableBasisPoints?: number }) {
  const response: Resp<ClubPromotionPolicy> = await request.patch("/promotions", input);
  return response.getData();
}

export async function issueClubCoupon(input: {
  requestId: string; customerUserId: string; name: string; kind: "rate_coupon" | "threshold_coupon";
  payableBasisPoints?: number; thresholdCents?: number; discountCents?: number;
}) {
  const response: Resp<PlatformPromotionSource> = await request.post("/promotions/coupons", input);
  return response.getData();
}

export async function getDispatchHistory(after?: string) {
  const response: Resp<{ items: DispatchPricingRow[]; nextCursor: string | null }> = await request.get("/dispatch-pricing", { params: { limit: 5, after } });
  return response.getData() ?? { items: [], nextCursor: null };
}

export async function getSettlements(after?: string) {
  const response: Resp<{ items: GiftSettlementRow[]; nextCursor: string | null }> =
    await request.get("/settlements", { params: { after } });
  return response.getData() ?? { items: [], nextCursor: null };
}

export async function getSettlement(orderId: string, calculationId?: string) {
  const route = `/orders/${orderId}/settlement`;
  const response: Resp<AdminGiftSettlement> = await request.get(calculationId ? `${route}/calculations/${calculationId}` : route);
  return response.getData();
}
