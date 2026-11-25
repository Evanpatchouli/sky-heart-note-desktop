import { useState } from "react";
import { Alert, Button, Flex, Input, Typography } from "antd";
import { RequestError } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";

type Activation = { activationUrl: string; expiresAt: number };

export default function CustomerActivation({ route }: { route: string }) {
  const [activation, setActivation] = useState<Activation>();
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function issue() {
    setIssuing(true);
    setActivation(undefined);
    setCopied(false);
    setError("");
    try {
      setActivation(await employeeRequest<Activation>(`${route}/customer-activation`, "POST"));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到生成结果，请重新生成并分享最新链接");
    } finally {
      setIssuing(false);
    }
  }

  async function copy() {
    if (!activation) return;
    setError("");
    try {
      await navigator.clipboard.writeText(activation.activationUrl);
      setCopied(true);
    } catch {
      setError("无法自动复制，请选中链接后手动复制");
    }
  }

  return <Flex vertical gap="small" style={{ marginBlock: 8 }}>
    <Typography.Text type="secondary">请仅将链接发给这位老板，由本人设置账号和密码。重新生成会使上一条链接失效。</Typography.Text>
    <div><Button loading={issuing} onClick={issue}>{activation ? "重新生成激活链接" : "生成激活链接"}</Button></div>
    {activation && <>
      <Flex gap="small" wrap>
        <Input aria-label="老板激活链接" value={activation.activationUrl} readOnly onFocus={event => event.target.select()} />
        <Button onClick={copy}>复制激活链接</Button>
      </Flex>
      <Typography.Text type="secondary">有效至 {new Date(activation.expiresAt).toLocaleString("zh-CN")}</Typography.Text>
      {copied && <span role="status">已复制激活链接</span>}
    </>}
    {error && <Alert type="error" showIcon title={error} />}
  </Flex>;
}
