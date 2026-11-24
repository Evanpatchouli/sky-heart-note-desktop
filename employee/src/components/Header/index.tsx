import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, Avatar, Button, Dropdown, Segmented } from "antd";
import {
  AppstoreOutlined, BarsOutlined, CalendarOutlined, DownOutlined,
  LogoutOutlined, OrderedListOutlined, TableOutlined, UserOutlined,
} from "@ant-design/icons";
import { useAuthSession, useSessionActions } from "@webapp-template/common/web-auth";
import MemberBrand from "#/components/MemberBrand";
import Timenow from "./timenow";

const views = [
  { label: "时间轴", value: "timeline", icon: <OrderedListOutlined /> },
  { label: "列表", value: "list", icon: <BarsOutlined /> },
  { label: "日历", value: "calendar", icon: <CalendarOutlined /> },
  { label: "表格", value: "datagrid", icon: <TableOutlined /> },
  { label: "看板", value: "kanban", icon: <AppstoreOutlined /> },
];

export default function Header() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useAuthSession();
  const { logout, loggingOut, logoutError } = useSessionActions();
  const name = user.nickname || user.username || "我的账号";
  const role = user.roles.includes("admin") ? "管理员" : "团员";
  const currentView = views.find(view => view.value === params.get("vtype"))?.value ?? "timeline";

  return (
    <header className="member-appbar">
      <div className="member-appbar__row">
        <MemberBrand compact />
        <nav className="member-appbar__views" aria-label="订单视图">
          <Segmented
            aria-label="订单视图"
            options={views}
            value={currentView}
            onKeyDownCapture={event => {
              // The native radio moves focus and emits change on arrow keys.
              // Let it do so once, without Segmented also pushing a history entry.
              if (event.target instanceof HTMLInputElement && event.key.startsWith("Arrow")) event.stopPropagation();
            }}
            onChange={value => {
              const next = new URLSearchParams(params);
              next.set("vtype", value);
              navigate({ pathname: "/", search: next.toString() });
            }}
          />
        </nav>
        <div className="member-appbar__account">
          <Timenow />
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            menu={{
              "aria-label": "账户操作",
              items: [
                {
                  key: "identity",
                  type: "group",
                  label: <span className="member-account-label">
                    <strong>{user.username || name}</strong><span>{role}</span>
                  </span>,
                  children: [
                    { key: "logout", icon: <LogoutOutlined />, label: "退出登录", disabled: loggingOut },
                  ],
                },
              ],
              onClick: ({ key }) => {
                if (key === "logout") {
                  setMenuOpen(false);
                  void logout();
                }
              },
            }}
          >
            <Button type="text" className="member-appbar__user" aria-label={`账户菜单，${name}`}
              aria-haspopup="menu" aria-expanded={menuOpen} loading={loggingOut}>
              <Avatar className="member-appbar__avatar" size={32} icon={<UserOutlined />} />
              <span className="member-appbar__name">{name}</span>
              <DownOutlined className="member-appbar__chevron" />
            </Button>
          </Dropdown>
        </div>
      </div>
      {logoutError && <Alert type="error" showIcon role="alert" title={logoutError} />}
    </header>
  );
}
