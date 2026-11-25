import { useNavigate } from "react-router";
import { getAppToken, invalidateSession } from "@sky-club/common/web-auth";
import { useEvent } from "./useEmitter";
import { logout } from "@/api/user.api";

export default function useLogout() {
  const nav = useNavigate();
  useEvent("user.logout", async () => {
    const token = getAppToken("admin");
    try {
      await logout();
      if (getAppToken("admin") !== token) return;
      invalidateSession("admin");
      nav("/login", { replace: true });
    } catch { /* 请求层展示失败信息，可以重试。 */ }
  });
}
