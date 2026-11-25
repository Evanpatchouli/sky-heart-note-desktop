import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { BarsOutlined } from "@ant-design/icons";
import { Button, Drawer, Flex, Grid, Layout, theme, Typography } from "antd";
import dayjs from "dayjs";
import { APP_NAME } from "@/constants";
import "./admin-shell.css";

function MobileNavigation({ menu }: { menu: ReactNode }) {
  const location = useLocation();
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const open = openedAt === location.key;
  useEffect(() => {
    const restoreFocus = wasOpen.current && !open;
    wasOpen.current = open;
    if (restoreFocus) {
      const frame = requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);
  return <>
    <Button ref={trigger} aria-label="展开导航" aria-haspopup="dialog" aria-expanded={open}
      icon={<BarsOutlined />} onClick={() => setOpenedAt(location.key)} />
    <Drawer title="导航" placement="left" size={260} open={open} onClose={() => setOpenedAt(null)}
      focusable={{ focusTriggerAfterClose: false }}
      afterOpenChange={visible => { if (!visible) setOpenedAt(null); }}
      styles={{ body: { background: "#001529", padding: "8px 0" } }} destroyOnHidden>
      <nav aria-label="管理端导航">{menu}</nav>
    </Drawer>
  </>;
}

export default function AdminShell({ menu, account, children }: {
  menu: ReactNode;
  account: ReactNode;
  children: ReactNode;
}) {
  const { token: { colorBgContainer, borderRadiusLG } } = theme.useToken();
  const { lg } = Grid.useBreakpoint();
  return (
    <Layout className="admin-shell">
      {lg ? <Layout.Sider id="admin-navigation">
        <Flex style={{ padding: "10px 12px 8px" }} align="center">
          <Typography.Text style={{ marginInlineStart: 12, color: "#eee", fontSize: 18 }}>
            {APP_NAME}
          </Typography.Text>
        </Flex>
        <nav aria-label="管理端导航">{menu}</nav>
      </Layout.Sider> : null}
      <Layout style={{ display: "flex", flexDirection: "column" }}>
        <Layout.Header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: 20, background: colorBgContainer, flexShrink: 0,
        }}>
          {lg ? <span /> : <MobileNavigation menu={menu} />}
          {account}
        </Layout.Header>
        <Layout.Content id="view-container" style={{
          flex: 1, display: "flex", flexDirection: "column",
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
