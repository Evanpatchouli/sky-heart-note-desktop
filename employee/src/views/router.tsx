import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import Header from "#/components/Header";
import Root from "./root";
import ErrorPage from "./error";
import MemberNavigation, { MemberHome } from "./mobile-navigation";
import { useSearchParams } from "react-router";
import ServiceOrderPage from "./service-orders";

const ClubOperations = lazy(() => import("./club-operations"));
const AdjustmentApprovals = lazy(() => import("./club-financial/approvals"));
const MemberBalance = lazy(() => import("./club-financial/balance"));
const ClubDispatch = lazy(() => import("./club-dispatch"));
const GiftClaims = lazy(() => import("./gift-claims"));
const ClaimBoard = lazy(() => import("./claim-board"));
const ClubAssignments = lazy(() => import("./club-assignments"));
const errorElement = <><Header /><ErrorPage /></>;
function BusinessPage({ scope, children }: { scope: "dispatch" | "board" | "mine"; children: React.ReactNode }) {
  const [params] = useSearchParams();
  return ["daily_run", "companionship"].includes(params.get("business") ?? "") ? <ServiceOrderPage scope={scope} /> : children;
}

export default createBrowserRouter([
  { element: <MemberNavigation />, children: [
  { index: true, element: <MemberHome />, errorElement },
  { path: "/workspace", element: <Root />, errorElement },
  {
    path: "/club/gift-claims",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载按次接单…</p></>}><GiftClaims /></Suspense>,
    errorElement,
  },
  {
    path: "/club/operations",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载俱乐部运营…</p></>}><ClubOperations /></Suspense>,
    errorElement,
  },
  {
    path: "/club/financial-adjustments",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载调整审批…</p></>}><AdjustmentApprovals /></Suspense>,
    errorElement,
  },
  {
    path: "/club/balance",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载余额…</p></>}><MemberBalance /></Suspense>,
    errorElement,
  },
  {
    path: "/club/dispatch",
    element: <BusinessPage scope="dispatch"><Suspense fallback={<><Header /><p className="member-pending" role="status">加载派单准备…</p></>}><ClubDispatch /></Suspense></BusinessPage>,
    errorElement,
  },
  {
    path: "/claim-board",
    element: <BusinessPage scope="board"><Suspense fallback={<><Header /><p className="member-pending" role="status">加载接单区…</p></>}><GiftClaims legacyClaimPath="/club/heart-claims" /></Suspense></BusinessPage>,
    errorElement,
  },
  {
    path: "/club/heart-claims",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载接单区…</p></>}><ClaimBoard /></Suspense>,
    errorElement,
  },
  {
    path: "/club/assignments",
    element: <BusinessPage scope="mine"><Suspense fallback={<><Header /><p className="member-pending" role="status">加载我的承接…</p></>}><ClubAssignments /></Suspense></BusinessPage>,
    errorElement,
  },
  ] },
], {
  basename: import.meta.env.BASE_URL,
});
