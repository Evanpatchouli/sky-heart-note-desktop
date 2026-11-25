import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex, Input, Modal, Select, Typography } from "antd";
import type { GiftShare } from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";

type PersonalAccount = { id: string; localId: string; name: string };

function message(error: unknown) {
  return error instanceof RequestError ? error.message : "未收到处理结果，请刷新核对后重试";
}

export function GiftExecutionAccounts({ orderRoute, share, readOnly, onSaved }: {
  orderRoute: string;
  share: GiftShare;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const { token } = useAuthSession();
  const [linkOpen, setLinkOpen] = useState(false);
  const [accounts, setAccounts] = useState<PersonalAccount[]>();
  const [selection, setSelection] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController>(undefined);
  const route = `${orderRoute}/shares/${share.id}/execution-accounts`;
  const linked = share.executionGameAccounts ?? [];
  const linkedIds = new Set(linked.map(account => account.personalAccountId));
  const options = (accounts ?? []).filter(account => !linkedIds.has(account.id))
    .map(account => ({ value: account.id, label: `${account.name} · #${account.localId}` }));

  useEffect(() => {
    if (!linkOpen) return;
    const controller = new AbortController();
    employeeRequest<PersonalAccount[]>("songxinhao/linkable", "GET", undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setAccounts(value);
      setLoadError("");
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(message(error));
    });
    return () => controller.abort();
  }, [linkOpen, revision, token]);

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

  function open() {
    setError("");
    setFeedback("");
    setSelection(undefined);
    setAccounts(undefined);
    setLoadError("");
    setCreating(false);
    setName("");
    setLinkOpen(true);
  }

  function submit() {
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
        setLinkOpen(false);
        setFeedback("送心号已关联");
        onSaved();
      });
    }
  }

  return <div style={{ paddingBlock: 8 }}>
    <Flex align="center" gap="small" wrap>
      <Typography.Text strong>送心号</Typography.Text>
      {!readOnly && <Button size="small" onClick={open}>关联送心号</Button>}
    </Flex>
    {feedback && <Typography.Text type="success" role="status">{feedback}</Typography.Text>}
    {linked.length === 0 ? <div><Typography.Text type="secondary">暂无关联送心号</Typography.Text></div> :
      <Flex vertical gap="small" style={{ marginTop: 8 }}>{linked.map(account =>
        <div key={account.id} style={{ borderTop: "1px solid #DBE2EB", paddingBlock: 8, overflowWrap: "anywhere" }}>
          <div><strong>{account.name}</strong> · 个人编号 #{account.localAccountId}</div>
          <Typography.Text type="secondary">送心号标识 <code>{account.personalAccountId}</code></Typography.Text>
        </div>)}</Flex>}
    {linkOpen && <Modal open title={creating ? "新建个人送心号" : "关联送心号"}
      onCancel={() => setLinkOpen(false)} onOk={submit} confirmLoading={busy} closable={!busy} keyboard={!busy}
      cancelText="取消" cancelButtonProps={{ disabled: busy }} mask={{ closable: !busy }}
      okText={creating ? "保存个人送心号" : "确认关联"}
      okButtonProps={{ disabled: readOnly || (creating ? !name.trim() || !!error : !selection) }}>
      {creating ? <>
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
      </>}
      {error && <Alert showIcon type="error" title={error} style={{ marginTop: 8 }} />}
    </Modal>}
  </div>;
}
