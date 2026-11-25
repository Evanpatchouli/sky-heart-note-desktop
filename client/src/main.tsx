import { createRoot } from "react-dom/client";
import { AuthGate } from "@webapp-template/common/web-auth";
import { CustomerActivation } from "./customer-activation";
import ClubInvitation from "./club-invitation";
import MyOrders, { OrderDetail } from "./my-orders";
import { NewOrder } from "./new-order";
import "./order.css";

const orderIdPattern = /^[a-f0-9]{24}$/i;

function ClientApp() {
  const path = window.location.pathname.replace(/\/$/, "");
  const isCreate = path === "/order";
  const isDetail = path === "/order-detail";
  const query = new URLSearchParams(window.location.search);
  const orderId = query.get("order");

  return <main className="client-orders">
    <header className="client-orders__header">
      <a href="/">送心手记 · 客户端</a>
      <nav aria-label="客户端导航">
        <a href="/" aria-current={isCreate ? undefined : "page"}>我的订单</a>
        <a href="/order" aria-current={isCreate ? "page" : undefined}>下单</a>
      </nav>
    </header>
    {isCreate ? <NewOrder /> : isDetail ? orderId && orderIdPattern.test(orderId)
      ? <OrderDetail key={orderId} orderId={orderId} />
      : <p role="alert">订单链接无效。</p> : <MyOrders />}
  </main>;
}

createRoot(document.getElementById("root")!).render(
  /^\/activate\/?$/.test(window.location.pathname)
    ? <CustomerActivation />
    : /^\/join-club\/?$/.test(window.location.pathname) ? <ClubInvitation />
    : <AuthGate app="client"><ClientApp /></AuthGate>,
);
