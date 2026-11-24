import { createRoot } from "react-dom/client";
import { AuthGate } from "@webapp-template/common/web-auth";

createRoot(document.getElementById("root")!).render(
  <AuthGate app="client"><main><h1>送心手记 · 客户端</h1></main></AuthGate>,
);
