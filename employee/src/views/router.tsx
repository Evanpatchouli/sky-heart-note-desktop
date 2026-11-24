import { createBrowserRouter } from "react-router-dom";
import Root from "./root";
import ErrorPage from "./error";

export default createBrowserRouter([{ path: "/", element: <Root />, errorElement: <ErrorPage /> }], {
  basename: import.meta.env.BASE_URL,
});
