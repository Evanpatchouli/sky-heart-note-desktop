import { createBrowserRouter } from "react-router-dom";
import Header from "#/components/Header";
import Root from "./root";
import ErrorPage from "./error";

export default createBrowserRouter([{ path: "/", element: <Root />, errorElement: <><Header /><ErrorPage /></> }], {
  basename: import.meta.env.BASE_URL,
});
