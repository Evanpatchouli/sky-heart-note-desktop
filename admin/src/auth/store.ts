import type { AppSession } from "@sky-club/common/web-auth";
import { create } from "zustand";

interface LoginStore {
  isLogin: boolean;
  token: string | null;
  userInfo: Omit<AppSession, "token"> | null;
}
export const useLoginStore = create<LoginStore>(() => ({ isLogin: false, token: null, userInfo: null }));

export function acceptSession(session: AppSession | null) {
  if (!session) { useLoginStore.setState({ isLogin: false, token: null, userInfo: null }); return; }
  const { token, ...userInfo } = session;
  useLoginStore.setState({ token, userInfo, isLogin: true });
}
