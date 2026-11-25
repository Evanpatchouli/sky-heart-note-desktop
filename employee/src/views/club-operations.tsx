import { useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Empty, Flex, Form, Input, InputNumber, Spin, Typography } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, type CommissionRule } from "@webapp-template/common";
import { RequestError } from "@webapp-template/common/web-auth";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";

const permissions = {
  CLUB_MEMBERS_MANAGE: "成员管理",
  CLUB_COMMISSION_MANAGE: "团抽配置",
  CLUB_ORDERS_READ: "管理端订单查看",
  CLUB_FINANCE_READ: "管理端财务查看",
};
type Permission = keyof typeof permissions;
const positions = { leader: "团长", deputy: "副团长", member: "团员" };
type Position = keyof typeof positions;
type Member = { userId: string; nickname: string | null; position?: Position; active: boolean; dispatcher: boolean };
type GrantMember = Pick<Member, "userId" | "nickname"> & {
  position: Position;
  permissions: Permission[];
  grantablePermissions: Permission[];
};
type Authorizations = { permissions: Permission[]; members: GrantMember[] };
export type EmployeeClub = {
  name: string;
  orderUrl: string;
  canAssignPendingOrders: boolean;
  canManageAuthorizations: boolean;
  permissions: Permission[];
};

function requestError(error: unknown) {
  return error instanceof RequestError ? error.message : "请求失败，请检查网络连接后重试";
}

function useClubRead<T>(path: string, revision = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<T>(path, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(err => { if (!controller.signal.aborted) setError(requestError(err)); });
    return () => controller.abort();
  }, [path, attempt, revision]);

  function reload() {
    setError("");
    setAttempt(value => value + 1);
  }
  return { data, setData, error, reload };
}

function ReadError({ error, reload }: { error: string; reload: () => void }) {
  return <Alert type="error" showIcon title={error} action={<Button onClick={reload}>重试</Button>} />;
}

export default function ClubOperations() {
  const club = useClubRead<EmployeeClub | null>("club");
  const [membershipVersion, setMembershipVersion] = useState(0);
  const [positionVersion, setPositionVersion] = useState(0);
  const info = club.data;
  return <>
    <Header />
    <main style={{ flex: 1, overflow: "auto", padding: 16, width: "100%", boxSizing: "border-box" }}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>俱乐部运营</Typography.Title>
        {club.error ? <ReadError error={club.error} reload={club.reload} />
          : info === undefined ? <Spin aria-label="加载俱乐部" />
          : !info?.permissions.length && !info?.canManageAuthorizations ? <Empty description="当前账号没有俱乐部运营权限" />
          : <>
            <Typography.Text strong>{info.name}</Typography.Text>
            {info.canManageAuthorizations ? <ClubName key={info.name} name={info.name}
              onRename={name => club.setData({ ...info, name })} /> : null}
            {info.permissions.includes("CLUB_MEMBERS_MANAGE") ? <ClubMembers positionVersion={positionVersion}
              onMembershipChange={() => setMembershipVersion(value => value + 1)} /> : null}
            {info.permissions.includes("CLUB_COMMISSION_MANAGE") ? <ClubCommission /> : null}
            {info.canManageAuthorizations ? <ClubAuthorizations membershipVersion={membershipVersion}
              onDeputyChange={() => setPositionVersion(value => value + 1)} /> : null}
          </>}
      </Flex>
    </main>
  </>;
}

function ClubName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function rename({ name }: { name: string }) {
    setSaving(true);
    setError("");
    try {
      const saved = await employeeRequest<{ name: string }>("club/name", "PATCH", { name: name.trim() });
      onRename(saved.name);
    } catch (error) {
      setError(requestError(error));
    } finally {
      setSaving(false);
    }
  }

  return <Card title="俱乐部名称">
    <Form layout="vertical" initialValues={{ name }} onFinish={rename}>
      <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入名称" }]}>
        <Input maxLength={80} />
      </Form.Item>
      <Button htmlType="submit" type="primary" loading={saving}>保存名称</Button>
    </Form>
    {error ? <Alert type="error" showIcon title={error} /> : null}
  </Card>;
}

function ClubMembers({ onMembershipChange, positionVersion }: { onMembershipChange: () => void; positionVersion: number }) {
  const members = useClubRead<Member[]>("club/members", positionVersion);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ userId: string }>();

  async function update(route: string, method: string, body: { active: boolean } | { dispatcher: boolean }) {
    setSaving(true);
    setError("");
    try {
      await employeeRequest(route, method, body);
      members.reload();
      if ("active" in body) onMembershipChange();
      return true;
    } catch (error) {
      setError(requestError(error));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function setActive(userId: string, active: boolean) {
    return update(`club/members/${userId}`, "PUT", { active });
  }

  return <Card title="成员管理">
    <Flex vertical gap="small">
      {members.error ? <ReadError error={members.error} reload={members.reload} />
        : !members.data ? <Spin aria-label="加载团员" />
        : members.data.map(member => <Flex key={member.userId} gap="small" wrap align="center">
          <Typography.Text>{member.nickname || "团员"}（{member.userId}）</Typography.Text>
          {member.active ? <>
            <Checkbox checked={member.dispatcher} disabled={saving} onChange={event =>
              void update(`club/members/${member.userId}/dispatcher`, "PATCH", { dispatcher: event.target.checked })}>
              派单候选
            </Checkbox>
            {member.position !== "leader" && member.position !== "deputy" ? <Button
              disabled={saving} onClick={() => void setActive(member.userId, false)}>停用成员</Button> : null}
          </> : <Button disabled={saving} onClick={() => void setActive(member.userId, true)}>恢复成员</Button>}
        </Flex>)}
      <Form form={form} layout="vertical" onFinish={async ({ userId }: { userId: string }) => {
        if (await setActive(userId.trim().toUpperCase(), true)) form.resetFields();
      }}>
        <Form.Item label="平台用户 ID" name="userId" rules={[
          { required: true, message: "请输入平台用户 ID" },
          { pattern: /^[A-Z0-9]{4}$/i, message: "请输入四位用户 ID" },
        ]}>
          <Input maxLength={4} style={{ maxWidth: 160 }} />
        </Form.Item>
        <Button htmlType="submit" disabled={saving}>添加已有账号</Button>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Flex>
  </Card>;
}

function ClubCommission() {
  const rule = useClubRead<CommissionRule | null>("club/commission-rule");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save({ amount }: { amount: string }) {
    const clubFeeCents = parseYuanAsCents(amount);
    if (clubFeeCents === null || rule.data === undefined) return;
    const expectedVersion = rule.data?.version ?? 0;
    setError("");
    setSaving(true);
    try {
      rule.setData(await employeeRequest("club/commission-rule", "PATCH", { expectedVersion, clubFeeCents }));
    } catch (error) {
      setError(requestError(error));
      if (error instanceof RequestError && error.status === 409) rule.reload();
    } finally {
      setSaving(false);
    }
  }

  return <Card title="团抽配置">
    {rule.error ? <ReadError error={rule.error} reload={rule.reload} />
      : rule.data === undefined ? <Spin aria-label="加载团抽规则" />
      : <Form key={rule.data?.version ?? 0} layout="vertical" onFinish={save}
        initialValues={{ amount: rule.data?.basis === "gift_times" ? formatCentsAsYuan(rule.data.clubFeeCents) : undefined }}>
        {rule.data ? <Typography.Text>当前规则 V{rule.data.version}</Typography.Text> : null}
        <Form.Item name="amount" label="每次团抽（元/次）" rules={[
          { required: true, message: "请填写每次团抽金额" },
          { validator: (_, value) => parseYuanAsCents(value) === null
            ? Promise.reject(new Error("请填写非负金额，最多两位小数")) : Promise.resolve() },
        ]}>
          <InputNumber<string> stringMode min="0" step="0.01" style={{ width: "100%", maxWidth: 240 }} />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={saving}>保存团抽规则</Button>
      </Form>}
    {error ? <Alert type="error" showIcon title={error} /> : null}
  </Card>;
}

function ClubAuthorizations({ membershipVersion, onDeputyChange }: { membershipVersion: number; onDeputyChange: () => void }) {
  const entries = useClubRead<Authorizations>("club/authorizations", membershipVersion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function update(userId: string, path: string, body: unknown) {
    setSaving(true);
    setError("");
    try {
      await employeeRequest(`club/authorizations/${userId}/${path}`, "PATCH", body);
      entries.reload();
      if (path === "deputy") onDeputyChange();
    } catch (error) {
      setError(requestError(error));
    } finally {
      setSaving(false);
    }
  }

  return <Card title="运营授权">
    {entries.error ? <ReadError error={entries.error} reload={entries.reload} />
      : !entries.data ? <Spin aria-label="加载授权" />
      : <Flex vertical gap="middle">
        {entries.data.members.map(member => <fieldset key={member.userId} style={{ minWidth: 0 }}>
          <legend>{member.nickname || "团员"}（{member.userId}） · {positions[member.position]}</legend>
          <Flex wrap gap="small">
            {member.position !== "leader" ? <Checkbox checked={member.position === "deputy"} disabled={saving}
              onChange={event => void update(member.userId, "deputy", { deputy: event.target.checked })}>副团长</Checkbox> : null}
            {entries.data?.permissions.map(permission => <Checkbox key={permission}
              checked={member.permissions.includes(permission)}
              disabled={saving || !member.grantablePermissions.includes(permission)}
              onChange={event => void update(member.userId, "permission", { permission, granted: event.target.checked })}>
              {permissions[permission]}
            </Checkbox>)}
          </Flex>
        </fieldset>)}
      </Flex>}
    {error ? <Alert type="error" showIcon title={error} /> : null}
  </Card>;
}
