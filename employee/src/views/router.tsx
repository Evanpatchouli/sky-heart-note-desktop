import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import Header from "#/components/Header";
import Root from "./root";
import ErrorPage from "./error";

const ClubOperations = lazy(() => import("./club-operations"));
const ClubDispatch = lazy(() => import("./club-dispatch"));
const GiftClaims = lazy(() => import("./gift-claims"));
const errorElement = <><Header /><ErrorPage /></>;

export default createBrowserRouter([
  { path: "/", element: <Root />, errorElement },
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
    path: "/club/dispatch",
    element: <Suspense fallback={<><Header /><p className="member-pending" role="status">加载派单准备…</p></>}><ClubDispatch /></Suspense>,
    errorElement,
  },
], {
  basename: import.meta.env.BASE_URL,
});
