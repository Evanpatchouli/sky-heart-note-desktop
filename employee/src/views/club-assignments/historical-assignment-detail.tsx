import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Input, Modal, Select, Spin, Tag, Typography } from "antd";
import { getAppToken, useAuthSession, useSessionActions } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import DeliveryDiary from "./delivery-diary";
import PersonalSettlementCard from "./personal-settlement";
import PersonalScheduleDialog from "./personal-schedule";
import {
  type AssignedOrder, type AssignmentShare, type DeliveryProgress, type LinkableAccount,
  type PersonalSchedule, requestMessage, scheduleLabel, totalHearts,
} from "./types";

export default function AssignmentDetail({ route, onSaved, onScheduleSaved, onReady }: {
  route: string;
  onSaved: () => void;
  onScheduleSaved: (schedule: PersonalSchedule) => void;
  onReady: () => void;
}) {
  const { token } = useAuthSession();
  const { loggingOut } = useSessionActions();
  const [order, setOrder] = useState<AssignedOrder>();
  const [accounts, setAccounts] = useState<LinkableAccount[]>();
  const [detailError, setDetailError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [accountAttempt, setAccountAttempt] = useState(0);
  const [newName, setNewName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const inFlight = useRef<AbortController>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<AssignedOrder>(`${route}/assignment`, "GET", undefined, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setDetailError("");
        setOrder(value);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setOrder(undefined);
        setDetailError(requestMessage(err));
      });
    return () => controller.abort();
  }, [route, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<LinkableAccount[]>("songxinhao/linkable", "GET", undefined, controller.signal)
      .then(items => {
        if (controller.signal.aborted) return;
        setAccountsError("");
        setAccounts(items);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setAccounts(undefined);
        setAccountsError(requestMessage(err));
      });
    return () => controller.abort();
  }, [accountAttempt]);

  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => {
    if (order || detailError) onReady();
  }, [order, detailError, onReady]);

  function reload() {
    setDetailError("");
    setAccountsError("");
    setAttempt(value => value + 1);
    setAccountAttempt(value => value + 1);
    onSaved();
  }

  async function save(path: string, input: unknown, completion: () => void) {
    if (inFlight.current || loggingOut || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    inFlight.current = controller;
    setSaving(true);
    setFeedback("");
    setSaveError("");
    try {
      await employeeRequest(path, "POST", input, controller.signal);
      if (controller.signal.aborted || getAppToken("employee") !== token) return;
      completion();
    } catch (err) {
      if (getAppToken("employee") === token) setSaveError(requestMessage(err));
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSaving(false);
    }
  }

  const linkedIds = new Set(order?.shares.flatMap(share => share.executionGameAccounts.map(account => account.personalAccountId)));
  const personalIds = accounts ? new Set(accounts.map(account => account.id)) : undefined;
  const available = accounts?.filter(account => !linkedIds.has(account.id)) ?? [];
  const disabled = saving || loggingOut;
  const stopped = order?.delivery?.orderStoppedHearts !== undefined;
  const accountRoute = (shareId: string) => `${route}/shares/${shareId}/execution-accounts`;

  return <Card title="承接详情" extra={<Button onClick={reload} disabled={disabled}>刷新详情</Button>}>
    {detailError ? <Alert type="error" showIcon title={detailError} /> : !order ? <Spin aria-label="加载承接详情" /> : null}
    {order && !order.shares.length ? <Empty description="这笔订单当前没有你的承接份额" /> : null}
    {order && order.shares.length > 0 ? <Flex vertical gap="middle">
      <Flex className="assignment-schedule-summary" justify="space-between" align="center" gap="small" wrap>
        <span>本人排期 <strong>{scheduleLabel(order.personalSchedule)}</strong></span>
        <Button disabled={disabled} onClick={() => setEditingSchedule(true)}>调整本人排期</Button>
      </Flex>
      {order.delivery?.myReportSyncPending ? <Alert showIcon type="warning" title="本人有日报仍待同步" /> : null}
      {order.delivery?.myPendingReports ? <Alert showIcon type="info" title={`本人有 ${order.delivery.myPendingReports} 条日报记录待核对`} /> : null}
      <div>
        <Typography.Title level={4} style={{ margin: 0, overflowWrap: "anywhere" }}>接收游戏账号 {order.recipientGameAccount}</Typography.Title>
        <code className="club-order-number">{order.id}</code>
        <dl className="club-order-facts">
          <div><dt>本人承接 / 全单交付</dt><dd>{totalHearts(order)} / {order.fulfillmentHearts ?? order.requestedHearts} 颗</dd></div>
        </dl>
      </div>
      {order.delivery ? <DeliveryDiary order={order} delivery={order.delivery} route={route} refresh={attempt} disabled={disabled} onSaved={() => {
        setAttempt(value => value + 1);
        onSaved();
      }} /> : null}
      <PersonalSettlementCard route={route} revision={attempt} role="member" />
      <Flex align="center" justify="space-between" wrap gap="small">
        <Typography.Title level={5} style={{ margin: 0 }}>本人份额与执行账号</Typography.Title>
        {!stopped ? <Button disabled={disabled || !accounts} onClick={() => { setSaveError(""); setNewName(""); }}>新建个人送心号</Button> : null}
      </Flex>
      {accountsError ? <Alert type="error" showIcon title={accountsError} /> : !accounts ? <Spin aria-label="加载个人送心号" /> : null}
      {feedback ? <Alert type="success" showIcon role="status" title={feedback} /> : null}
      {saveError && newName === undefined ? <Alert type="error" showIcon title={saveError} /> : null}
      {order.shares.map(share => <ShareAccounts key={share.id} share={share} available={available}
        progress={order.delivery?.shares.find(item => item.id === share.id)}
        disabled={disabled || stopped} personalIds={personalIds}
        onLink={personalAccountId => { void save(accountRoute(share.id), { personalAccountId }, () => {
          setFeedback("送心号已关联");
          setAttempt(value => value + 1);
          onSaved();
        }); }}
      />)}
    </Flex> : null}
    {editingSchedule && order ? <PersonalScheduleDialog route={route} orderName={order.recipientGameAccount} schedule={order.personalSchedule}
      onClose={() => setEditingSchedule(false)} onReload={() => { setEditingSchedule(false); reload(); }}
      onSaved={schedule => {
        setOrder(previous => previous && { ...previous, personalSchedule: schedule });
        setEditingSchedule(false);
        setFeedback("本人排期已保存");
        onScheduleSaved(schedule);
      }} /> : null}
    {newName !== undefined ? <Modal open title="新建个人送心号" okText="保存个人送心号" cancelText="取消"
      onCancel={() => setNewName(undefined)} confirmLoading={saving} closable={!saving} keyboard={!saving}
      cancelButtonProps={{ disabled: saving }} okButtonProps={{ disabled: !newName.trim() || loggingOut || !!saveError }}
      mask={{ closable: !saving }} onOk={() => { void save("songxinhao", { name: newName.trim() }, () => {
        setNewName(undefined);
        setFeedback("个人送心号已保存，可从份额下方选择");
        setAccountAttempt(value => value + 1);
      }); }}>
      <label htmlFor="new-personal-game-account">送心号名称</label>
      <Input id="new-personal-game-account" value={newName} maxLength={120} disabled={saving}
        onChange={event => setNewName(event.target.value)} />
      {saveError ? <Alert type="error" showIcon title={saveError}
        description="请关闭并刷新详情，核对个人送心号列表后再新建。" /> : null}
    </Modal> : null}
  </Card>;
}

function ShareAccounts({ share, available, progress, disabled, personalIds, onLink }: {
  share: AssignmentShare;
  available: LinkableAccount[];
  progress?: DeliveryProgress["shares"][number];
  disabled: boolean;
  personalIds?: ReadonlySet<string>;
  onLink: (personalAccountId: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const selection = available.find(account => account.id === selected);
  const kind = share.claimKind === "directed" ? "定向承接" : share.claimKind === "public" ? "公开承接" : "历史承接";
  return <Card size="small" title={`${kind} · ${share.hearts} 颗`}>
    <Flex vertical gap="small">
      <Typography.Text type="secondary" className="club-order-number">份额 {share.id}</Typography.Text>
      {progress ? <Typography.Text type="secondary">份额内已抵扣 {progress.creditedHearts} 颗 · {progress.stoppedHearts !== undefined
        ? `已停送 ${progress.stoppedHearts}` : `剩余 ${progress.remainingHearts}`} 颗</Typography.Text> : null}
      {share.executionGameAccounts.length ? <ul className="club-share-list">
        {share.executionGameAccounts.map(account => {
          const removed = account.personalAccountId && personalIds && !personalIds.has(account.personalAccountId);
          return <li key={account.id}>
            <div>
              <strong>{account.name}</strong>
              {account.localAccountId ? <Typography.Text type="secondary"> · 个人编号 #{account.localAccountId}</Typography.Text> : null}
              {removed ? <div><Tag>个人库已移除</Tag><code className="club-order-number">执行账号 {account.id}</code></div> : null}
            </div>
            {!account.personalAccountId && <Tag>历史执行账号</Tag>}
          </li>;
        })}
      </ul> : <Typography.Text type="secondary">还没有关联的送心号</Typography.Text>}
      <Flex className="club-account-picker" gap="small" wrap>
        <Select value={selection?.id} onChange={setSelected} showSearch={{ optionFilterProp: "label" }}
          disabled={disabled || !personalIds || !available.length} aria-label={`为 ${share.hearts} 颗的份额选择个人送心号`}
          placeholder={available.length ? "选择个人送心号" : personalIds ? "暂无可关联的个人送心号" : "个人送心号暂不可用"}
          options={available.map(({ id, localId, name }) => ({ value: id, label: `${name} · #${localId}` }))} />
        <Button onClick={() => selection && onLink(selection.id)} disabled={disabled || !selection}>关联送心号</Button>
      </Flex>
    </Flex>
  </Card>;
}
