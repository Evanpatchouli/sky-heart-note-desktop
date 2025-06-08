import { createBrowserRouter, redirect } from "react-router-dom";
import Root from "./root";
import ErrorPage from "./error";
import { AppError } from "./error/app-error";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Root />,
      errorElement: <ErrorPage />,
      children: [],
      loader: ({ request }) => {
        const url = new URL(request.url);
        const vtype = url.searchParams.get("vtype");
        return {
          vtype: vtype || "timeline",
        };
      },
    },
  ],
  {
    basename: "/",
    // strict: true, // 严模式，URL 末尾不允许出现 /，例如 /about 和 /about/
  }
);

export default router;
