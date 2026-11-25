import { createBrowserRouter } from "react-router-dom";
import Header from "#/components/Header";
import Root from "./root";
import ErrorPage from "./error";
import ClubDispatch from "./club-dispatch";

export default createBrowserRouter([
  { path: "/", element: <Root />, errorElement: <><Header /><ErrorPage /></> },
  { path: "/club/dispatch", element: <ClubDispatch /> },
], {
  basename: import.meta.env.BASE_URL,
});
