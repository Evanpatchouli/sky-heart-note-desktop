import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { AuthGate, useAuthSession, useSessionActions } from "@sky-club/common/web-auth";
import { registerPwa } from "@sky-club/common/pwa";
import { NotificationBell } from "@sky-club/common/notifications";
import { CustomerActivation } from "./customer-activation";
import ClubInvitation from "./club-invitation";
import { NavigationIcon, useMobileViewport } from "@sky-club/common/mobile-navigation";
import { MyOrders, OrderDetail } from "./my-orders";
import { NewOrder } from "./new-order";
import { ServiceOrders } from "@sky-club/common/service-orders";
import { orderCursor, orderListHref, orderSource, readClientContext, readClientNavigationOwner, rememberClientContext, rememberClientNavigationOwner, rememberedOrderList } from "./navigation";
import "./my-orders.css";

const orderIdPattern = /^[a-f0-9]{24}$/i;

function ClientApp() {
  const { id: userId, token } = useAuthSession();
  const path = window.location.pathname.replace(/\/$/, "");
  const query = new URLSearchParams(window.location.search);
  const orderId = query.get("order");
  const isDetail = path === "/order-detail";
  const isOrderList = !path;
  const isCreate = path === "/order";
  const isAccount = path === "/account";
  const business = query.get("business") === "companionship" ? "companionship" : query.get("business") === "daily_run" ? "daily_run" : undefined;
  const serviceOrder = query.get("serviceOrder");
  const serviceHref = (selected?: string) => `${isCreate && !selected ? "/order" : "/"}?${new URLSearchParams({ business: business ?? "daily_run", ...(selected ? { serviceOrder: selected } : {}) })}`;
  const cursor = orderCursor();
  const source = orderSource();
  const list = isOrderList ? orderListHref(cursor, source) : rememberedOrderList(userId);
  const lastDetail = readClientContext(userId, "detail");
  const ordersTab = !isDetail && !isOrderList && lastDetail?.startsWith("/order-detail?") ? lastDetail : list;
  const previousOwner = readClientNavigationOwner();
  const previousAccount = previousOwner && previousOwner !== userId ? previousOwner : null;
  const currentHref = window.location.pathname + window.location.search;
  const cameFromOtherList = previousAccount && isOrderList && !!window.location.search &&
    currentHref === rememberedOrderList(previousAccount);
  const cameFromOtherDetail = previousAccount && isDetail && currentHref === readClientContext(previousAccount, "detail");
  const returnTo = cameFromOtherDetail ? lastDetail || rememberedOrderList(userId)
    : cameFromOtherList ? rememberedOrderList(userId) : currentHref;
  const restoreAccount = returnTo !== currentHref && (cameFromOtherDetail || cameFromOtherList);
  useMobileViewport();

  useEffect(() => {
    if (restoreAccount) {
      window.location.replace(returnTo);
      return;
    }
    rememberClientNavigationOwner(userId);
    if (isOrderList) {
      rememberClientContext(userId, "cursor", cursor ?? "");
      rememberClientContext(userId, "source", source ?? "");
      rememberClientContext(userId, "detail", "");
    }
    if (isDetail && orderId && orderIdPattern.test(orderId)) {
      rememberClientContext(userId, "detail", `/order-detail?${new URLSearchParams({ order: orderId })}`);
    }
  }, [isOrderList, isDetail, orderId, userId, cursor, source, restoreAccount, returnTo]);

  if (restoreAccount) return null;

  return <main className="client-orders">
    <header className="client-orders__header">
      <a href="/" className="client-orders__brand"><img src="/pwa/icon-192.png" alt="" width="28" height="28" />Sky Club <span>· 客户端</span></a>
      <nav aria-label="客户端导航">
        <a href={list} aria-current={isOrderList || isDetail ? "page" : undefined}>我的订单</a>
        <a href="/order" aria-current={isCreate ? "page" : undefined}>下单</a>
        <a href="/account" aria-current={isAccount ? "page" : undefined}>我的</a>
      </nav>
      <NotificationBell app="client" token={token} />
    </header>
    {(isCreate || isOrderList) ? <nav aria-label="业务类型" className="service-business-switch"><a href={isCreate ? "/order" : "/"} aria-current={!business ? "page" : undefined}>送心</a><a href={isCreate ? "/order?business=daily_run" : "/?business=daily_run"} aria-current={business === "daily_run" ? "page" : undefined}>代跑</a><a href={isCreate ? "/order?business=companionship" : "/?business=companionship"} aria-current={business === "companionship" ? "page" : undefined}>陪玩</a></nav> : null}
    {business && (isCreate || isOrderList) ? <ServiceOrders key={`${userId}:${isCreate}:${business}`} app="client" userId={userId} token={token} business={business} create={isCreate} orderId={serviceOrder} onOpen={id => window.location.assign(serviceHref(id))} /> : isCreate ? <NewOrder /> : isDetail ? orderId && orderIdPattern.test(orderId)
      ? <OrderDetail key={orderId} orderId={orderId} />
      : <><h1>订单详情</h1><p role="alert">订单链接无效。</p></> : isAccount ? <ClientAccount /> : <MyOrders />}
    <nav className="client-bottom-tabs" aria-label="客户端底部导航">
      <a href={ordersTab} aria-current={!isCreate && !isAccount ? "page" : undefined}><NavigationIcon name="orders" /><span>订单</span></a>
      <a href="/order" aria-current={isCreate ? "page" : undefined}><NavigationIcon name="plus" /><span>下单</span></a>
      <a href="/account" aria-current={isAccount ? "page" : undefined}><NavigationIcon name="user" /><span>我的</span></a>
    </nav>
  </main>;
}

function ClientAccount() {
  const user = useAuthSession();
  const { logout, loggingOut, logoutError } = useSessionActions();
  return <section className="client-orders__panel client-account">
    <h1>我的</h1>
    <dl><dt>账号</dt><dd>{user.nickname || user.username}</dd><dt>用户 ID</dt><dd>{user.id}</dd></dl>
    <button type="button" disabled={loggingOut} onClick={() => void logout()}>退出登录</button>
    {logoutError ? <p className="client-orders__error" role="alert">{logoutError}</p> : null}
  </section>;
}

createRoot(document.getElementById("root")!).render(
  /^\/activate\/?$/.test(window.location.pathname)
    ? <CustomerActivation />
    : /^\/join-club\/?$/.test(window.location.pathname) ? <ClubInvitation />
    : <AuthGate app="client"><ClientApp /></AuthGate>,
);
registerPwa("client");
