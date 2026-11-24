import { Menu, type MenuProps } from "antd";
import { useNavigate, useLocation } from "react-router";
import { useMemo } from "react";
import React from "react";
import { DashboardOutlined, UserOutlined } from "@ant-design/icons";

type MenuItems = NonNullable<MenuProps["items"]>;
const noAdditionalItems: MenuItems = [];

export const AuthMenu: React.FC<{ additionalItems?: MenuItems }> = ({ additionalItems = noAdditionalItems }) => {
  const nav = useNavigate();
  const location = useLocation();
  // const { hasPermission, hasRole } = usePermissionChecker();

  const createItems = (): MenuProps["items"] => {
    return [
      {
        key: "/dashboard",
        icon: React.createElement(DashboardOutlined),
        label: "仪表盘",
      },
      ...additionalItems,
      {
        key: "/system",
        icon: React.createElement(DashboardOutlined),
        label: "系统管理",
        children: [
          {
            key: "/system/role",
            icon: React.createElement(UserOutlined),
            label: "角色管理",
          },
          {
            key: "/system/user",
            icon: React.createElement(UserOutlined),
            label: "用户管理",
          },
        ],
      },
      {
        key: "/permission-demo",
        icon: React.createElement(UserOutlined),
        label: "权限示例",
      },
    ] as MenuProps["items"];
  };

  const items = useMemo(
    () =>
      createItems(),
    [additionalItems],
  );

  const handleClick = ({ key }: { key: string }) => {
    nav(key);
  };

  const openKeys = useMemo(() => {
    const pathSegments = location.pathname.split("/").filter(Boolean);
    if (pathSegments.length > 1) {
      return ["/" + pathSegments[0]];
    }
    return [];
  }, []);

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[location.pathname]}
      defaultOpenKeys={openKeys}
      items={items}
      onClick={handleClick}
    />
  );
};
