import { Navigate, Outlet } from "react-router";
import { useLoginStore } from "@/auth/store";
import useLogout from "@/hooks/useLogout";
import UserAvatar from "@/components/UserAvatar";
import AdminShell from "@/components/layouts/AdminShell";
import { AuthMenu } from "./components/auth-menu";

export default function Home() {
  const loggedIn = useLoginStore(s => s.isLogin);
  useLogout();
  if (!loggedIn) return <Navigate to="/login" replace />;
  return <AdminShell menu={<AuthMenu />} account={<UserAvatar />}><Outlet /></AdminShell>;
}
