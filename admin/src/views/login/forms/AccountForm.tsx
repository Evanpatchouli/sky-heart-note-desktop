import { useState } from "react";
import { Button, Form, Input, message } from "antd";
import { useNavigate } from "react-router";
import Captcha from "@/components/captcha";
import { CaptchaWay } from "@/constants";
import { accountLogin } from "@/api/user.api";
import { UserLoginEvent } from "@/events/user.event";
import { useEmit } from "@/hooks/useEmitter";
import type { AccountLoginForm } from "@/types/user";

export default function AccountForm() {
  const nav = useNavigate();
  const emitter = useEmit();
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
  return <Form onFinish={submit} layout="vertical">
    <Form.Item label="账号" name="username" rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
    <Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
    <Form.Item label="验证码" name="captcha" rules={[{ required: true }]}><Input maxLength={4} autoComplete="off" /></Form.Item>
    <div style={{ height: 42, marginBottom: 16 }}><Captcha key={revision} way={CaptchaWay.LOGIN} /></div>
    <Button type="primary" htmlType="submit" loading={busy} block>登录</Button>
  </Form>;
}
