import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Input, Modal, Select, Tag, Typography } from "antd";
import { formatCentsAsYuan } from "@webapp-template/common";
import type { GiftAccountRelationship, GiftExecutionAccount, GiftShare, GiftUnlockReview } from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

type PersonalAccount = { id: string; localId: string; name: string };
type Dialog = "link" | { account: GiftExecutionAccount; kind: GiftAccountRelationship };

const relationships = {
  existing_friend: "已有好友",
  new_unlock: "实际新解锁成功",
};

function message(error: unknown) {
  return error instanceof RequestError ? error.message : "未收到处理结果，请刷新核对后重试";
}

function money(amountCents: number | null) {
  return amountCents === null ? "待核对" : "¥" + formatCentsAsYuan(amountCents);
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function AccountRelationship({ account }: { account: GiftExecutionAccount }) {
  const relation = account.relationship;
  if (!relation) return <Typography.Text type="secondary">待登记关系</Typography.Text>;
  return <>
    <div><Tag>{relationships[relation.kind]}</Tag><span>{money(relation.amountCents)}</span></div>
    <div>发生 {dateTime(relation.occurredAt)} · 登记 {dateTime(relation.recordedAt)}</div>
  </>;
}

export function GiftExecutionAccounts({ orderRoute, share, recipient, unitPrice, readOnly, onSaved }: {
  orderRoute: string;
  share: GiftShare;
  recipient: string;
  unitPrice: number | null;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const { token } = useAuthSession();
  const [dialog, setDialog] = useState<Dialog>();
  const [accounts, setAccounts] = useState<PersonalAccount[]>();
  const [selection, setSelection] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController>(undefined);
  const choosing = dialog === "link";
  const route = `${orderRoute}/shares/${share.id}/execution-accounts`;
  const linked = share.executionGameAccounts ?? [];
  const linkedIds = new Set(linked.map(account => account.personalAccountId));
  const options = (accounts ?? []).filter(account => !linkedIds.has(account.id))
    .map(account => ({ value: account.id, label: `${account.name} · #${account.localId}` }));

  useEffect(() => {
    if (!choosing) return;
    const controller = new AbortController();
    employeeRequest<PersonalAccount[]>("songxinhao/linkable", "GET", undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setAccounts(value);
      setLoadError("");
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(message(error));
    });
    return () => controller.abort();
  }, [choosing, revision, token]);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function save(path: string, input: object, completion: () => void) {
    if (inFlight.current || getAppToken("employee") !== token || readOnly) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    inFlight.current = controller;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await employeeRequest(path, "POST", input, controller.signal);
      if (!controller.signal.aborted && getAppToken("employee") === token) completion();
    } catch (error) {
      if (getAppToken("employee") === token) setError(message(error));
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setBusy(false);
    }
  }

  function open(next: Dialog) {
    setError("");
    setFeedback("");
    setSelection(undefined);
    setAccounts(undefined);
    setLoadError("");
    setOccurredAt("");
    setCreating(false);
    setName("");
    setDialog(next);
  }

  function submit() {
    if (!dialog) return;
    if (dialog === "link") {
      if (creating) {
        void save("songxinhao", { name: name.trim() }, () => {
          setCreating(false);
          setName("");
          setSelection(undefined);
          setAccounts(undefined);
          setRevision(value => value + 1);
        });
      } else if (selection) {
        void save(route, { personalAccountId: selection }, () => {
          setDialog(undefined);
          setFeedback("送心号已关联");
          onSaved();
        });
      }
      return;
    }
    const occurrence = occurredAt ? new Date(occurredAt) : undefined;
    if (occurrence && !Number.isFinite(occurrence.getTime())) {
      setError("请填写有效的发生时间");
      return;
    }
    void save(`${route}/${dialog.account.id}/relationship`, {
      relationship: dialog.kind, ...(occurrence ? { occurredAt: occurrence.toISOString() } : {}),
    }, () => {
      setDialog(undefined);
      setFeedback("关系已登记");
      onSaved();
    });
  }

  return <div style={{ paddingBlock: 8 }}>
    <Flex align="center" gap="small" wrap>
      <Typography.Text strong>送心号与解锁</Typography.Text>
      {!readOnly && <Button size="small" onClick={() => open("link")}>关联送心号</Button>}
    </Flex>
    {feedback && <Typography.Text type="success" role="status">{feedback}</Typography.Text>}
    {linked.length === 0 ? <div><Typography.Text type="secondary">暂无关联送心号</Typography.Text></div> :
      <Flex vertical gap="small" style={{ marginTop: 8 }}>{linked.map(account =>
        <div key={account.id} style={{ borderTop: "1px solid #DBE2EB", paddingBlock: 8, overflowWrap: "anywhere" }}>
          <div><strong>{account.name}</strong> · 个人编号 #{account.localAccountId}</div>
          <Typography.Text type="secondary">送心号标识 <code>{account.personalAccountId}</code></Typography.Text>
          <AccountRelationship account={account} />
          {!readOnly && !account.relationship && <Flex gap="small" wrap style={{ marginTop: 4 }}>
            <Button onClick={() => open({ account, kind: "existing_friend" })}>已有好友</Button>
            <Button onClick={() => open({ account, kind: "new_unlock" })}>实际新解锁成功</Button>
          </Flex>}
        </div>)}</Flex>}
    {dialog && <Modal open title={choosing ? creating ? "新建个人送心号" : "关联送心号" : `确认${relationships[dialog.kind]}`}
      onCancel={() => setDialog(undefined)} onOk={submit} confirmLoading={busy} closable={!busy} keyboard={!busy}
      cancelText="取消" cancelButtonProps={{ disabled: busy }} mask={{ closable: !busy }}
      okText={choosing ? creating ? "保存个人送心号" : "确认关联" : "确认登记"}
      okButtonProps={{ disabled: readOnly || (choosing && (creating ? !name.trim() || !!error : !selection)) }}>
      {choosing ? creating ? <>
        <label htmlFor={`gift-account-${share.id}`}>送心号名称</label>
        <Input id={`gift-account-${share.id}`} value={name} maxLength={120} disabled={busy}
          onChange={event => setName(event.target.value)} />
      </> : <>
        <Select aria-label="选择个人送心号" placeholder="选择个人送心号" showSearch loading={!accounts && !loadError}
          optionFilterProp="label" value={selection} onChange={setSelection} options={options} style={{ width: "100%" }} />
        {loadError && <Alert type="error" showIcon title={loadError} action={<Button onClick={() => {
          setLoadError("");
          setRevision(value => value + 1);
        }}>重试</Button>} />}
        <Button type="link" disabled={!accounts} onClick={() => { setError(""); setSelection(undefined); setCreating(true); }}>新建个人送心号</Button>
      </> : <>
        <Typography.Paragraph style={{ overflowWrap: "anywhere" }}>{dialog.account.name} → {recipient}</Typography.Paragraph>
        <Typography.Paragraph>{dialog.kind === "existing_friend" ? "已有好友，新增解锁费用 ¥0.00。"
          : unitPrice === null ? "请确认游戏中已成功解锁，本次费用待核对。"
          : `请确认游戏中已成功解锁，本次登记解锁费用 ${money(unitPrice)}。`}</Typography.Paragraph>
        <label htmlFor={`gift-occurred-${share.id}`}>实际发生时间（可留空，默认当前时间）</label>
        <Input id={`gift-occurred-${share.id}`} type="datetime-local" value={occurredAt} disabled={busy}
          onChange={event => setOccurredAt(event.target.value)} />
      </>}
      {error && <Alert showIcon type="error" title={error} style={{ marginTop: 8 }} />}
    </Modal>}
  </div>;
}

export function GiftUnlockReviewCard({ review }: { review: GiftUnlockReview }) {
  return <Card size="small" title="解锁核对">
    <Flex gap="small" vertical>
      <Typography.Text style={{ overflowWrap: "anywhere" }}>接收游戏号 {review.recipientGameAccount}</Typography.Text>
      <Typography.Text>原报价预估解锁 {review.estimatedCount ?? "未记录"} 次 · {money(review.estimatedAmountCents)}</Typography.Text>
      <Typography.Text>实际新解锁 {review.actualCount} 次 · {money(review.actualAmountCents)}
        {review.unpricedCount > 0 && ` · ${review.unpricedCount} 次费用待核对`}</Typography.Text>
      <Typography.Text>原现金实收 {money(review.receivedAmountCents)}</Typography.Text>
      {review.members.map(member => <div key={member.userId}>
        {member.nickname ? `${member.nickname} · ` : ""}{member.userId} · 新解锁 {member.actualCount} 次 · {money(member.actualAmountCents)}
        {member.unpricedCount > 0 && ` · ${member.unpricedCount} 次费用待核对`}
      </div>)}
      {review.records.length > 0 && <details>
        <summary>关联与登记明细</summary>
        <Flex vertical>
          {review.records.map(account => <div key={account.id} style={{ borderTop: "1px solid #DBE2EB", paddingBlock: 8, overflowWrap: "anywhere" }}>
            <div><strong>{account.name}</strong> · 个人编号 #{account.localAccountId} → {account.recipientGameAccount}</div>
            <div>送心员 {account.memberNickname ?? ""} {account.userId}</div>
            {account.customerUserId && <div>老板平台账号 {account.customerNickname ?? ""} {account.customerUserId}</div>}
            <div>送心号标识 <code>{account.personalAccountId}</code></div>
            <div>关联 {dateTime(account.linkedAt)}</div>
            <AccountRelationship account={account} />
          </div>)}
        </Flex>
      </details>}
    </Flex>
  </Card>;
}
