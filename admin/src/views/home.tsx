import { Navigate, Outlet } from "react-router";
import { useEffect, useState } from "react";
import { AuditOutlined, BellOutlined } from "@ant-design/icons";
import { NotificationBell } from "@sky-club/common/notifications";
import type { MenuProps } from "antd";
import { getAdminClub, type AdminClub } from "@/api/club.api";
import { useLoginStore } from "@/auth/store";
import useLogout from "@/hooks/useLogout";
import UserAvatar from "@/components/UserAvatar";
import AdminShell from "@/components/layouts/AdminShell";
import { AuthMenu } from "./components/auth-menu";

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
  const token = useLoginStore(s => s.token);
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
  const mayReadFinance = club?.permissions.includes("CLUB_FINANCE_READ");
  const mayPayWithdrawal = club?.permissions.includes("CLUB_WITHDRAWAL_PAY");
  const clubChildren: MenuProps["items"] = [
    ...(mayConfigureRule ? [{ key: "/club/rules", label: "抽成规则" }] : []),
    ...(mayReadFinance || mayPayWithdrawal ? [{ key: "/club/settlements", label: mayReadFinance ? "结算核对" : "提现实付" }] : []),
    ...(club?.canDecideAdjustments || mayReadFinance ? [{ key: "/club/penalties", label: "罚款管理" }] : []),
  ];
  const clubItems: MenuProps["items"] = clubChildren.length ? [{
    key: "/club", label: "俱乐部管理", icon: <AuditOutlined />, children: clubChildren,
  }] : [];
  return <AdminShell menu={<AuthMenu additionalItems={clubItems} />} account={
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {token ? <NotificationBell app="admin" token={token} icon={<BellOutlined />} /> : null}
      <UserAvatar />
    </div>
  }>
    <Outlet context={{ club, loadFailed, reload: () => setAttempt(value => value + 1) } satisfies AdminClubContext} />
  </AdminShell>;
}
