/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigate, useRouteError } from "react-router-dom";
import { AppErrorID, AppError } from "./app-error";
import NotFound from "./doc-not-found";
import Default from "./default";
import { FC } from "react";
import "./index.css";

// 定义类型别名
type ErrorHandlerMapType = {
  [key in AppErrorID]: (props: { error: AppError }) => React.ReactNode;
} & Record<string, FC<{ error: Error }>>;

// 使用类型别名
const ErrorHandlerMap: ErrorHandlerMapType = {
  "404": NotFound,
  // Add more error types as needed
  // ["custom-error-id"]: () => <h1>Custom error message</h1>,
};

export default function ErrorPage() {
  const error = useRouteError() as AppError;
  const nav = useNavigate();

  return (
    <div className="error-page">
      {error.id && ErrorHandlerMap[error.id as AppErrorID] ? (
        ErrorHandlerMap[error.id]({ error })
      ) : error.status === 404 ? (
        <NotFound error={error} />
      ) : (
        <Default error={error} />
      )}

      <p>
        <a
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
          href="/"
        >
          回到首页
        </a>
      </p>

      {/* <pre>{process.env.NODE_ENV === 'development' && error.stack && <code>{error.stack}</code>}</pre> */}

      {/* <p>If the issue persists, please contact the support team.</p> */}
      <p>如果问题仍然存在，请联系支持团队</p>

      <p>
        <a href="https://github.com/Evanpatchouli/uni-sky-admin/issues/new" target="_blank">
          报告问题
          {/* Report an issue */}
        </a>
      </p>

      <p>
        <a href="https://github.com/Evanpatchouli/uni-sky-admin/blob/main/CONTRIBUTING.md" target="_blank">
          为项目尽一份绵薄之力
          {/* Contribute to the project */}
        </a>
      </p>
    </div>
  );
}
