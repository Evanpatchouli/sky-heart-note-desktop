import { createRoot } from "react-dom/client";
import { AuthGate } from "@webapp-template/common/web-auth";
import { CustomerActivation } from "./customer-activation";
import MyOrders from "./my-orders";

createRoot(document.getElementById("root")!).render(
  /^\/activate\/?$/.test(window.location.pathname)
    ? <CustomerActivation />
    : <AuthGate app="client"><MyOrders /></AuthGate>,
);
