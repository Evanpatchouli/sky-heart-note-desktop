import { useState } from "react";
import { Alert, Button, ConfigProvider, Form, Input } from "antd";
import { ArrowRightOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { SharedAccounts, type SignInProps } from "@sky-club/common/web-auth";
import MemberBrand from "#/components/MemberBrand";
import landscape from "#/assets/member-sky.webp";
import styles from "./login.module.css";
import CaptchaDialog, { type Credentials } from "./CaptchaDialog";

const theme = {
  token: {
    colorPrimary: "#204b72",
    colorText: "#172e40",
    colorTextSecondary: "#52677c",
    colorBorder: "#bdcad6",
    borderRadius: 8,
    controlHeightLG: 40,
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
};

export default function MemberLogin({ app, onLogin }: SignInProps) {
  const [pendingLogin, setPendingLogin] = useState<Credentials | null>(null);
  const [error, setError] = useState("");

  return (
    <ConfigProvider theme={theme}>
      <main className={styles.page}>
        <div className={styles.folio}>
          <aside className={styles.cover}>
            <img className={styles.landscape} src={landscape} alt="" />
            <MemberBrand />
            <div className={styles.caption}>
              <h2>团员工作台</h2>
              <p>订单与送心记录</p>
            </div>
          </aside>
          <section className={styles.panel} aria-labelledby="member-login-title">
            <div className={styles.panelBody}>
              <h1 id="member-login-title">团员端登录</h1>
              <SharedAccounts app={app} onLogin={onLogin} />
              <Form<Credentials> name="member_login" className={styles.credentials} size="large"
                onValuesChange={() => setError("")} onFinish={values => { setError(""); setPendingLogin(values); }}>
                <Form.Item name="username" rules={[{ required: true, whitespace: true, message: "请输入账号" }]}>
                  <Input prefix={<UserOutlined />} placeholder="账号" aria-label="账号" autoComplete="username" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="密码" aria-label="密码" autoComplete="current-password" />
                </Form.Item>
                {error && <Alert type="error" showIcon role="alert" title={error} className={styles.error} />}
                <Button type="primary" block className={styles.submit} htmlType="submit"
                  icon={<ArrowRightOutlined />} iconPlacement="end">登录</Button>
              </Form>
            </div>
          </section>
        </div>
      </main>
      {pendingLogin && <CaptchaDialog app={app} credentials={pendingLogin} onLogin={onLogin}
        onAccountError={setError} onClose={() => setPendingLogin(null)} />}
    </ConfigProvider>
  );
}
