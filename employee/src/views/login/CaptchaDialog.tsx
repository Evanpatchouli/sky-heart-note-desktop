import { useRef, useState } from "react";
import { Alert, Form, Input, Modal, type InputRef } from "antd";
import { PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { postLogin, RequestError, useAuthCaptcha, type SignInProps } from "@webapp-template/common/web-auth";
import styles from "./login.module.css";

export type Credentials = { username: string; password: string };
type Props = SignInProps & {
  credentials: Credentials;
  onAccountError: (message: string) => void;
  onClose: () => void;
};

export default function CaptchaDialog({ app, credentials, onLogin, onAccountError, onClose }: Props) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<{ captcha: string }>();
  const input = useRef<InputRef>(null);
  const challenge = useAuthCaptcha(app);

  function refresh() {
    form.setFieldValue("captcha", "");
    challenge.refresh();
    input.current?.focus();
  }

  async function verify({ captcha }: { captcha: string }) {
    if (!open || busy || !challenge.image) return;
    setBusy(true);
    setError("");
    try {
      onLogin(await postLogin(app, "account", { ...credentials, captcha }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "验证失败，请重试";
      if (err instanceof RequestError && [401, 403].includes(err.status)) {
        onAccountError(message);
        setOpen(false);
      } else {
        setError(message);
        refresh();
      }
    } finally { setBusy(false); }
  }

  return (
    <Modal title="图形验证" centered width={380} open={open}
      onCancel={() => { if (!busy) setOpen(false); }} afterClose={onClose}
      afterOpenChange={visible => { if (visible) input.current?.focus(); }}
      closable={!busy} keyboard={!busy} mask={{ closable: !busy }}
      cancelText="取消" cancelButtonProps={{ disabled: busy }}
      okText="验证并登录" okButtonProps={{ disabled: !challenge.image }}
      confirmLoading={busy} onOk={() => form.submit()}>
      <Form form={form} name="member_challenge" size="large" onFinish={verify}>
        <div className={styles.challenge}>
          <Form.Item name="captcha" rules={[
            { required: true, message: "请输入图形验证码" },
            { len: 4, message: "请输入 4 位验证码" },
          ]}>
            <Input ref={input} prefix={<PictureOutlined />} placeholder="4 位验证码"
              aria-label="图形验证码" autoComplete="off" maxLength={4} readOnly={busy} />
          </Form.Item>
          <button className={styles.captcha} type="button" onClick={refresh}
            aria-label="刷新验证码" title="刷新验证码" disabled={busy || (!challenge.image && !challenge.error)}>
            {challenge.image
              ? <img src={`data:image/svg+xml;base64,${challenge.image}`} alt="图形验证码" />
              : <ReloadOutlined spin={!challenge.error} />}
          </button>
        </div>
        {(challenge.error || error) && <Alert type="error" showIcon role="alert" title={challenge.error || error} />}
      </Form>
    </Modal>
  );
}
