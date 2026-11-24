import type {
  AccountLoginForm,
  EmailLoginForm,
  ILoginResult,
  PhoneLoginForm,
} from "@/types/user";
import { createAppRequest } from "./request";
import type Resp from "@/models/Resp";

const appRequest = createAppRequest("/user");
export const accountLogin = (
  data: AccountLoginForm,
): Promise<Resp<ILoginResult>> => appRequest.post("/login?type=account", { ...data, app: "admin" });

export const emailLogin = (data: EmailLoginForm): Promise<Resp<ILoginResult>> =>
  appRequest.post("/login?type=email", { ...data, app: "admin" });

export const phoneLogin = (data: PhoneLoginForm): Promise<Resp<ILoginResult>> =>
  appRequest.post("/login?type=phone", { ...data, app: "admin" });

export const logout = (): Promise<Resp<{}>> => appRequest.post("/logout");
