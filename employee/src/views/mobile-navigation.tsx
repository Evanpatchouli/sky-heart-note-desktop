import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useAuthSession } from "@webapp-template/common/web-auth";
import { NavigationIcon, useMobileViewport, usePhoneWidth } from "@webapp-template/common/mobile-navigation";
import Root from "./root";

const tabs = [
  { path: "/claim-board", title: "接单", icon: "inbox" },
  { path: "/club/dispatch", title: "派单", icon: "send" },
  { path: "/club/assignments", title: "我的", icon: "user" },
] as const;

const storageKey = (userId: string, path: string) => `sky-heart.employee.mobile-nav.v1:${userId}:${path}`;

export function rememberedMemberPath(userId: string, path: string) {
  try {
    const location = sessionStorage.getItem(storageKey(userId, path));
    if (location?.startsWith(`${path}?`)) return location;
  } catch { /* Navigation still works without session storage. */ }
  return path;
}

const navigationOwnerKey = "sky-heart.employee.mobile-nav.v1:current-user";

export function MemberHome() {
  const { id } = useAuthSession();
  const { search } = useLocation();
  const phone = usePhoneWidth();
  return phone && !search ? <Navigate replace to={rememberedMemberPath(id, "/claim-board")} /> : <Root />;
}

export default function MemberNavigation() {
  const { id } = useAuthSession();
  const { pathname, search } = useLocation();
  const current = pathname.replace(/\/$/, "") || "/";
  const active = current === "/club/gift-claims" || current === "/club/heart-claims"
    ? "/claim-board" : tabs.find(tab => tab.path === current)?.path ?? "/club/assignments";
  const [previousOwner] = useState(() => {
    try { return sessionStorage.getItem(navigationOwnerKey); } catch { return null; }
  });
  const isTab = tabs.some(tab => tab.path === current);
  const ownPath = rememberedMemberPath(id, current);
  const shouldRestoreOwnPath = !!previousOwner && previousOwner !== id && isTab && !!search &&
    rememberedMemberPath(previousOwner, current) === current + search && ownPath !== current + search;
  useMobileViewport();

  useEffect(() => {
    if (shouldRestoreOwnPath) return;
    try {
      sessionStorage.setItem(navigationOwnerKey, id);
      if (isTab) sessionStorage.setItem(storageKey(id, current), current + search);
    } catch { /* Optional UI context. */ }
  }, [id, current, search, isTab, shouldRestoreOwnPath]);

  if (shouldRestoreOwnPath) return <Navigate replace to={ownPath} />;

  return <>
    <Outlet />
    <nav className="member-bottom-tabs" aria-label="团员端导航">
      {tabs.map(({ path, title, icon }) => <Link key={path}
        to={path === current ? current + search : rememberedMemberPath(id, path)}
        aria-current={path === active ? "page" : undefined}>
        <NavigationIcon name={icon} /><span>{title}</span>
      </Link>)}
    </nav>
  </>;
}
