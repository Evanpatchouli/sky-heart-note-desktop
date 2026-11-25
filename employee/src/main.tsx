import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { AuthGate } from "@sky-club/common/web-auth";
import { registerPwa } from "@sky-club/common/pwa";
import "./index.css";

const App = lazy(() => import("./App"));
const MemberLogin = lazy(() => import("./views/login"));

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p className="member-pending" role="status">加载中…</p>}>
    <AuthGate app="employee" signInView={props => <MemberLogin {...props} />} showSessionBar={false}>
      <App />
    </AuthGate>
  </Suspense>
);
registerPwa("employee");
