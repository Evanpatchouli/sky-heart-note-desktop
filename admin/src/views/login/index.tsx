import { useState } from "react";
import { DesktopOutlined, QrcodeOutlined } from "@ant-design/icons";
import { Card, Typography } from "antd";
import { useTitle } from "@evanpatchouli/react-hooks-kit";
import { useNavigate } from "react-router";
import { SharedAccounts } from "@webapp-template/common/web-auth";
import { UserLoginEvent } from "@/events/user.event";
import { useEmit } from "@/hooks/useEmitter";
import { APP_NAME, SYSTEM_NAME } from "@/constants";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export default function LoginView() {
  useTitle(`登录 - ${APP_NAME}`);
  const [showQR, setShowQR] = useState(false);
  const emitter = useEmit();
  const nav = useNavigate();
  const switchLabel = showQR ? "切换账号登录" : "切换扫码登录";
  return (
    <main className={styles.page}>
      <Card className={styles.card} styles={{ body: { padding: 0 } }} variant="borderless">
        <div className={styles.panels}>
          <header className={styles.brand}>
            <div>
              <Typography.Title level={3}>{APP_NAME}</Typography.Title>
              <Typography.Text>{SYSTEM_NAME}</Typography.Text>
            </div>
          </header>
          <section className={styles.panel} aria-label="管理员登录">
            <button className={styles.corner} type="button" title={switchLabel}
              aria-label={switchLabel} onClick={() => setShowQR(value => !value)}>
              {showQR ? <DesktopOutlined /> : <QrcodeOutlined />}
            </button>
            {showQR ? (
              <div className={styles.qrStatus}>
                <Typography.Title level={2}>微信登录</Typography.Title>
                <Typography.Text type="secondary">微信扫码登录暂未开放</Typography.Text>
              </div>
            ) : (
              <div className={styles.content}>
                <SharedAccounts app="admin" onLogin={user => {
                  emitter.emit("user.login", new UserLoginEvent(user));
                  nav("/", { replace: true });
                }} />
                <LoginForm />
              </div>
            )}
          </section>
        </div>
      </Card>
    </main>
  );
}
