import { useState, type ReactNode } from "react";
import { BarsOutlined } from "@ant-design/icons";
import { Flex, Layout, theme, Typography } from "antd";
import dayjs from "dayjs";
import { APP_NAME } from "@/constants";

export default function AdminShell({ menu, account, children }: {
  menu: ReactNode;
  account: ReactNode;
  children: ReactNode;
}) {
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Layout style={{ minHeight: "100vh", maxHeight: "100vh" }}>
      <Layout.Sider id="admin-navigation" breakpoint="lg" collapsedWidth={0} onCollapse={setCollapsed}
        trigger={<button type="button" aria-label={collapsed ? "展开导航" : "收起导航"}
          aria-expanded={!collapsed} aria-controls="admin-navigation"
          style={{width:"100%",height:"100%",padding:0,border:0,background:"transparent",color:"inherit",font:"inherit",cursor:"pointer"}}>
          <BarsOutlined />
        </button>}>
        <Flex style={{ padding: "10px 12px 8px" }} align="center">
          <Typography.Text style={{ marginInlineStart: 12, color: "#eee", fontSize: 18 }}>
            {APP_NAME}
          </Typography.Text>
        </Flex>
        {menu}
      </Layout.Sider>
      <Layout style={{ display: "flex", flexDirection: "column" }}>
        <Layout.Header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: 20, background: colorBgContainer, flexShrink: 0,
        }}>
          <div />
          {account}
        </Layout.Header>
        <Layout.Content id="view-container" style={{
          margin: "24px 16px 0", padding: 24, flex: 1, display: "flex", flexDirection: "column",
          background: colorBgContainer, borderRadius: borderRadiusLG, overflow: "auto",
        }}>
          {children}
        </Layout.Content>
        <Layout.Footer style={{ textAlign: "center", flexShrink: 0 }}>
          Sky Club ©{dayjs().year()}
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
