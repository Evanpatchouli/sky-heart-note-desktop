import Resp from "@/models/Resp";
import { createAppRequest } from "./request";

const appRequest = createAppRequest("/login-log");

export const count = (
  range: "daily" | "weekly" | "monthly" | "yearly",
): Promise<Resp<number>> => appRequest.get(`/count/${range}`);

export type DailyLoginData = { date: string; count: number; growth: number | null };
export const getTrendData = (): Promise<Resp<DailyLoginData[]>> => appRequest.get("/trend/daily");
