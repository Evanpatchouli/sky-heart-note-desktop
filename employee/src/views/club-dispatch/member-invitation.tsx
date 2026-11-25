import { useState } from "react";
import { Alert, Button, Flex, Typography } from "antd";
import { RequestError } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

export default function MemberInvitation({ clubId }: { clubId: string }) {
  const [invitation, setInvitation] = useState<{ invitationUrl: string; expiresAt: number }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    setError("");
    try {
      setInvitation(await employeeRequest(`clubs/${clubId}/member-invitations`, "POST"));
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "暂时无法生成注册邀请");
    } finally {
      setBusy(false);
    }
  }

  return <Flex gap="small" wrap align="center">
    <Button loading={busy} onClick={() => void issue()}>生成本团注册邀请链接</Button>
    {invitation && <Typography.Text copyable={{ text: invitation.invitationUrl, tooltips: ["复制注册邀请链接", "已复制"] }}>
      <Typography.Link href={invitation.invitationUrl} target="_blank" rel="noopener noreferrer">本团注册邀请链接</Typography.Link>
      {" · "}{new Date(invitation.expiresAt).toLocaleString("zh-CN")} 到期
    </Typography.Text>}
    {error && <Alert type="error" showIcon title={error} />}
  </Flex>;
}
