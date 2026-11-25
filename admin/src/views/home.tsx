import { Navigate, Outlet } from "react-router";
import { useEffect, useState } from "react";
import { AuditOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { getAdminClub, type AdminClub } from "@/api/club.api";
import { useLoginStore } from "@/auth/store";
import useLogout from "@/hooks/useLogout";
import UserAvatar from "@/components/UserAvatar";
import AdminShell from "@/components/layouts/AdminShell";
import { AuthMenu } from "./components/auth-menu";

const clubItems: MenuProps["items"] = [{
  key: "/club", label: "俱乐部管理", icon: <AuditOutlined />,
  children: [{ key: "/club/rules", label: "抽成规则" }],
}];

export interface AdminClubContext {
  club: AdminClub | null | undefined;
  loadFailed: boolean;
  reload: () => void;
}

export default function Home() {
  const loggedIn = useLoginStore(s => s.isLogin);
  useLogout();
  if (!loggedIn) return <Navigate to="/login" replace />;
  return <AuthorizedHome />;
}

function AuthorizedHome() {
  const [club, setClub] = useState<AdminClub | null>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    getAdminClub().then(data => {
      if (active) setClub(data);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [attempt]);

  const mayConfigureRule = club?.permissions.includes("CLUB_COMMISSION_MANAGE");
  return <AdminShell menu={<AuthMenu additionalItems={mayConfigureRule ? clubItems : undefined} />} account={<UserAvatar />}>
    <Outlet context={{ club, loadFailed, reload: () => setAttempt(value => value + 1) } satisfies AdminClubContext} />
  </AdminShell>;
}
