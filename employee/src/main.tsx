import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { AuthGate } from "@webapp-template/common/web-auth";
import "./index.css";

const App = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
  <AuthGate app="employee">
    <Suspense fallback={<p role="status">正在加载工作台…</p>}><App /></Suspense>
  </AuthGate>
);
