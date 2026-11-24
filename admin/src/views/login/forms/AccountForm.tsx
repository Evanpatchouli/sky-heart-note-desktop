import { useState } from "react";
import { Button, Col, Form, Input, Row, Typography, message } from "antd";
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import Captcha from "@/components/captcha";
import { CaptchaWay } from "@/constants";
import { accountLogin } from "@/api/user.api";
import { UserLoginEvent } from "@/events/user.event";
import { useEmit } from "@/hooks/useEmitter";
import type { AccountLoginForm } from "@/types/user";
import { useLoginStore } from "@/auth/store";
import styles from "../login.module.css";

export default function AccountForm() {
  const nav = useNavigate();
  const emitter = useEmit();
  const isLogin = useLoginStore(state => state.isLogin);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  async function submit(values: AccountLoginForm) {
    setBusy(true);
    try {
      const reply = await accountLogin(values);
      if (reply.isSuccess() && reply.getData()) {
        emitter.emit("user.login", new UserLoginEvent(reply.getData()!));
        nav("/", { replace: true });
      } else {
        message.error(reply.getMessage());
        setRevision(n => n + 1);
      }
    } catch { setRevision(n => n + 1); }
    finally { setBusy(false); }
  }
  return (
    <>
      <div className={styles.welcome}>
        <Typography.Title level={2}>{isLogin ? "切换账号" : "欢迎登录"}</Typography.Title>
        <Typography.Text type="secondary">请使用管理员账号登录</Typography.Text>
      </div>
      <Form name="login_form" onFinish={submit} layout="vertical" size="large">
        <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
          <Input prefix={<UserOutlined className={styles.fieldIcon} />} placeholder="账号"
            aria-label="账号" autoComplete="username" allowClear />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
          <Input.Password prefix={<LockOutlined className={styles.fieldIcon} />} placeholder="密码"
            aria-label="密码" autoComplete="current-password" allowClear />
        </Form.Item>
        <Row gutter={8}>
          <Col span={16}>
            <Form.Item name="captcha" rules={[{ required: true, message: "请输入验证码" }]}>
              <Input prefix={<SafetyCertificateOutlined className={styles.fieldIcon} />} placeholder="4位验证码"
                aria-label="验证码" autoComplete="off" maxLength={4} allowClear />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Captcha key={revision} className={styles.captcha} way={CaptchaWay.LOGIN} />
          </Col>
        </Row>
        <Form.Item style={{ marginTop: 12 }}>
          <Button type="primary" htmlType="submit" loading={busy} block>立即登录</Button>
        </Form.Item>
      </Form>
    </>
  );
}
