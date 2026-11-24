import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from "react-router";
import { App as AntApp, Avatar, ConfigProvider, Dropdown, Result, Spin, Button, type MenuProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AuditOutlined, DollarOutlined, ProfileOutlined, SettingOutlined, TeamOutlined } from "@ant-design/icons";
import { ADMIN_USER_ID } from "@webapp-template/common";
import AdminShell from "@/components/layouts/AdminShell";
import { AuthMenu } from "@/views/components/auth-menu";
import { acceptSession } from "@/auth/store";
import { PERMISSIONS } from "@/constants/permissions";
import "@/index.css";
import "@/App.css";
import "./review.css";

const Dashboard = lazy(() => import("@/views/dashboard"));
const Users = lazy(() => import("@/views/system/user"));
const Roles = lazy(() => import("@/views/system/role"));
const Permissions = lazy(() => import("@/views/permission-demo"));
const Orders = lazy(() => import("./Orders"));
const Finance = lazy(() => import("./Finance"));
const Members = lazy(() => import("./Members"));
const Rules = lazy(() => import("./Rules"));

const clubMenu: NonNullable<MenuProps["items"]> = [{
  key:"/club", label:"俱乐部管理", icon:<TeamOutlined />,
  children:[
    {key:"/club/orders",label:"订单监管",icon:<ProfileOutlined />},
    {key:"/club/members",label:"团员管理",icon:<TeamOutlined />},
    {key:"/club/rules",label:"抽成规则",icon:<SettingOutlined />},
    {key:"/club/finance",label:"财务对账",icon:<DollarOutlined />},
  ],
}];

function ReviewHome() {
  const location = useLocation();
  const nav = useNavigate();
  // Close the zero-width Sider after navigating on touch screens.
  const compact = window.matchMedia("(max-width:991px)").matches;
  return <div className="admin-review">
    <AdminShell key={compact ? location.pathname : "wide"}
      menu={<AuthMenu key={location.pathname.split("/")[1]} additionalItems={clubMenu} />}
      account={<Dropdown trigger={["click"]} placement="bottomRight" arrow menu={{items:[
        { key:"identity", label:"管理员 · 本地原型", disabled:true },
        { key:"dashboard", label:"仪表盘", icon:<AuditOutlined /> },
        { key:"prototypes", label:<a href={import.meta.env.DEV ? "http://localhost:5190/prototype/index.html#member/board" : "../../prototype/index.html#member/board"}>团员与客户端原型</a> },
      ],onClick:({key})=>{ if(key==="dashboard") nav("/dashboard"); }}}>
        <button className="review-avatar" aria-label="管理员菜单" aria-haspopup="menu"><Avatar style={{backgroundColor:"dodgerblue"}}>管</Avatar></button>
      </Dropdown>}>
      <Suspense fallback={<Spin className="review-spinner" aria-label="加载页面" />}><Outlet /></Suspense>
    </AdminShell>
  </div>;
}

const router = createHashRouter([{
  path:"/",element:<ReviewHome />,children:[
    {index:true,element:<Navigate to="/club/orders" replace />},
    {path:"dashboard",element:<Dashboard />},
    {path:"system/user",element:<Users />},
    {path:"system/role",element:<Roles />},
    {path:"permission-demo",element:<Permissions />},
    {path:"club/orders",element:<Orders />},
    {path:"club/members",element:<Members />},
    {path:"club/rules",element:<Rules />},
    {path:"club/finance",element:<Finance />},
    {path:"*",element:<Result status="404" title="页面不存在" extra={<Button type="primary" href="#/club/orders">返回订单监管</Button>}/>},
  ],
}]);
declare const __CLUB_ADMIN_PREVIEW__: boolean;
const root = createRoot(document.getElementById("root")!);
if (typeof __CLUB_ADMIN_PREVIEW__ !== "undefined" && __CLUB_ADMIN_PREVIEW__) {
  // A display identity for the existing permission components; never written as an access token.
  acceptSession({id:ADMIN_USER_ID, username:"review_admin",nickname:"管理员",roles:["admin"],permissions:Object.values(PERMISSIONS),token:""});
  root.render(<ConfigProvider locale={zhCN}><AntApp><RouterProvider router={router}/></AntApp></ConfigProvider>);
} else {
  root.render(<Result title="请从设计原型入口进入" subTitle="在仓库根目录运行 pnpm --dir admin dev:prototype，然后打开终端显示的地址。" />);
}
