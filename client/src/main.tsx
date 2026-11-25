import { createRoot } from "react-dom/client";
import { AuthGate } from "@webapp-template/common/web-auth";
import MyOrders from "./my-orders";

createRoot(document.getElementById("root")!).render(
  <AuthGate app="client"><MyOrders /></AuthGate>,
);
