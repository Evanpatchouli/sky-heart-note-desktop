import type { ClubAdjustmentRecord, ClubBalance, ClubPenaltyList, PublishClubPenalty } from "@sky-club/common";
import type Resp from "@/models/Resp";
import { createAppRequest } from "./request";

const request = createAppRequest("/admin/club");

export async function getClubPenalties() {
  const response: Resp<ClubPenaltyList> = await request.get("/penalties");
  const data = response.getData();
  if (!data) throw new Error("罚款记录加载失败");
  return data;
}

export async function publishClubPenalty(input: PublishClubPenalty) {
  const response: Resp<ClubAdjustmentRecord> = await request.post("/penalties", input);
  return response.getData();
}

export async function getClubBalance(memberId?: string) {
  const response: Resp<ClubBalance> = await request.get(memberId ? `/balance/members/${encodeURIComponent(memberId)}` : "/balance");
  const data = response.getData();
  if (!data) throw new Error("余额加载失败");
  return data;
}
