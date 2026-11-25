import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { AuthGate, useAuthSession } from "@webapp-template/common/web-auth";
import { CustomerActivation } from "./customer-activation";
import ClubInvitation from "./club-invitation";
import MyOrders, { OrderDetail } from "./my-orders";
import { NewOrder } from "./new-order";
import { readClientContext, rememberClientContext } from "./navigation";
import { orderHref } from "./order-api";
import "./order.css";

const clubIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const orderIdPattern = /^[a-f0-9]{24}$/i;

function ClientApp() {
  const { id } = useAuthSession();
  const path = window.location.pathname.replace(/\/$/, "");
  const isCreate = path === "/order";
  const isDetail = path === "/order-detail";
  const query = new URLSearchParams(window.location.search);
  const lastClub = readClientContext(id, "club");
  const configuredClub = import.meta.env.VITE_CLIENT_ORDER_CLUB_ID?.trim();
  const clubHint = lastClub || configuredClub || undefined;
  const clubId = query.get("club") ?? (isCreate ? clubHint : undefined);
  const validClub = clubId && clubIdPattern.test(clubId) ? clubId : undefined;
  const orderId = query.get("order");

  useEffect(() => {
    if (validClub && (isCreate || isDetail)) rememberClientContext(id, "club", validClub);
  }, [id, validClub, isCreate, isDetail]);

  return <main className="client-orders">
    <header className="client-orders__header">
      <a href="/">送心手记 · 客户端</a>
      <nav aria-label="客户端导航">
        <a href="/" aria-current={isCreate ? undefined : "page"}>我的订单</a>
        <a href={orderHref(validClub ?? clubHint)} aria-current={isCreate ? "page" : undefined}>下单</a>
      </nav>
    </header>
    {isCreate ? validClub ? <NewOrder key={validClub} clubId={validClub} /> : <section className="client-orders__panel">
      <h1>送心下单</h1>
      <p>{clubId !== undefined ? "俱乐部下单链接无效，请向俱乐部确认链接。" : "请使用俱乐部提供的下单链接。已有订单可从订单详情向对应俱乐部下单。"}</p>
    </section> : isDetail ? validClub && orderId && orderIdPattern.test(orderId)
      ? <OrderDetail key={`${validClub}:${orderId}`} clubId={validClub} orderId={orderId} />
      : <p role="alert">订单链接无效。</p> : <MyOrders />}
  </main>;
}

createRoot(document.getElementById("root")!).render(
  /^\/activate\/?$/.test(window.location.pathname)
    ? <CustomerActivation />
    : /^\/join-club\/?$/.test(window.location.pathname) ? <ClubInvitation />
    : <AuthGate app="client"><ClientApp /></AuthGate>,
);
