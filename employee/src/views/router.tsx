import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import Header from "#/components/Header";
import Root from "./root";
import ErrorPage from "./error";
import MemberNavigation, { MemberHome } from "./mobile-navigation";

const ClubOperations = lazy(() => import("./club-operations"));
const AdjustmentApprovals = lazy(() => import("./club-financial/approvals"));
const MemberBalance = lazy(() => import("./club-financial/balance"));
const ClubDispatch = lazy(() => import("./club-dispatch"));
const GiftClaims = lazy(() => import("./gift-claims"));
const ClubAssignments = lazy(() => import("./club-assignments"));
const errorElement = <><Header /><ErrorPage /></>;

export default createBrowserRouter([
  { element: <MemberNavigation />, children: [
  { index: true, element: <MemberHome />, errorElement },
  { path: "/workspace", element: <Root />, errorElement },
  {
    path: "/claim-board",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载接单区…</p></>}><GiftClaims /></Suspense>,
    errorElement,
  },
  {
    path: "/club/gift-claims",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载接单区…</p></>}><GiftClaims /></Suspense>,
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
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载派单准备…</p></>}><ClubDispatch /></Suspense>,
    errorElement,
  },
  {
    path: "/club/assignments",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载我的承接…</p></>}><ClubAssignments /></Suspense>,
    errorElement,
  },
  ] },
], {
  basename: import.meta.env.BASE_URL,
});
