import { useState } from "react";
import { Alert, Button, ConfigProvider, Form, Input } from "antd";
import { ArrowRightOutlined, LockOutlined, PictureOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { postLogin, SharedAccounts, useAuthCaptcha, type SignInProps } from "@webapp-template/common/web-auth";
import MemberBrand from "#/components/MemberBrand";
import landscape from "#/assets/member-sky.webp";
import styles from "./login.module.css";

type Credentials = { username: string; password: string; captcha: string };
const theme = {
  token: {
    colorPrimary: "#204b72",
    colorText: "#172e40",
    colorTextSecondary: "#52677c",
    colorBorder: "#bdcad6",
    borderRadius: 8,
    controlHeightLG: 46,
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  },
};

export default function MemberLogin({ app, onLogin }: SignInProps) {
  const [form] = Form.useForm<Credentials>();
  const captcha = useAuthCaptcha(app);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function refreshCaptcha() {
    form.setFieldValue("captcha", "");
    captcha.refresh();
  }

  async function submit(values: Credentials) {
    if (busy || !captcha.image) return;
    setBusy(true);
    setError("");
    try {
      onLogin(await postLogin(app, "account", values));
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
      refreshCaptcha();
    } finally { setBusy(false); }
  }

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
              <Form form={form} name="member_login" layout="vertical" requiredMark={false} size="large" onFinish={submit}>
                <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
                  <Input prefix={<UserOutlined />} autoComplete="username" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                  <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                </Form.Item>
                <Form.Item label="图形验证码" htmlFor="member_login_captcha">
                  <div className={styles.challenge}>
                    <Form.Item name="captcha" noStyle rules={[{ required: true, message: "请输入图形验证码" }]}>
                      <Input prefix={<PictureOutlined />} placeholder="4 位验证码" autoComplete="off" maxLength={4} />
                    </Form.Item>
                    <button className={styles.captcha} type="button" onClick={refreshCaptcha}
                      aria-label="刷新验证码" title="刷新验证码" disabled={busy || (!captcha.image && !captcha.error)}>
                      {captcha.image
                        ? <img src={`data:image/svg+xml;base64,${captcha.image}`} alt="图形验证码" />
                        : <ReloadOutlined spin={!captcha.error} />}
                    </button>
                  </div>
                </Form.Item>
                {(error || captcha.error) && <Alert type="error" showIcon role="alert" title={error || captcha.error} className={styles.error} />}
                <Button type="primary" block className={styles.submit} htmlType="submit" loading={busy}
                  disabled={!captcha.image} icon={<ArrowRightOutlined />} iconPlacement="end">登录</Button>
              </Form>
            </div>
          </section>
        </div>
      </main>
    </ConfigProvider>
  );
}
