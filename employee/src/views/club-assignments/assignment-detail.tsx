import { useEffect, useState } from "react";
import { Alert, Button, Card, Flex, Spin, Typography } from "antd";
import { useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import GiftDeliveryDiary from "../gift-delivery-diary";
import { GiftExecutionAccounts } from "../club-dispatch/gift-execution-accounts";
import { GiftSchedule } from "../club-dispatch/gift-allocation";
import GiftSettlementCard from "./gift-settlement";
import PersonalScheduleDialog from "./personal-schedule";
import { PersonalProgress, StatusLabel } from "./record-views";
import {
  type AssignedOrder, type GiftAssignmentDetail, type PersonalSchedule,
  isGiftAssignment, requestMessage, scheduleLabel,
} from "./types";

type Props = {
  route: string;
  onSaved: () => void;
  onScheduleSaved: (schedule: PersonalSchedule) => void;
  onReady: () => void;
};

export default function AssignmentDetail(props: Props) {
  const { route, onSaved, onScheduleSaved, onReady } = props;
  const { token } = useAuthSession();
  const [order, setOrder] = useState<GiftAssignmentDetail | AssignedOrder>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [diary, setDiary] = useState(false);
  const [savedSchedule, setSavedSchedule] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<GiftAssignmentDetail | AssignedOrder>(`${route}/assignment`, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setOrder(value); setError(""); } })
      .catch(err => { if (!controller.signal.aborted) { setOrder(undefined); setError(requestMessage(err)); } });
    return () => controller.abort();
  }, [route, attempt, token]);

  useEffect(() => {
    if (order || error) onReady();
  }, [order, error, onReady]);

  function reload() {
    setError("");
    setAttempt(value => value + 1);
    onSaved();
  }

  return <Card title="承接详情" extra={<Button onClick={reload}>刷新详情</Button>}>
    {error ? <Alert type="error" showIcon title={error} /> : !order ? <Spin aria-label="加载承接详情" /> : <Flex vertical gap="middle">
      <div>
        <Typography.Title level={4} style={{ margin: 0, overflowWrap: "anywhere" }}>{order.recipientGameAccount}</Typography.Title>
        <code className="club-order-number">{order.id}</code>
      </div>
      <Flex className="assignment-schedule-summary" justify="space-between" align="center" gap="small" wrap>
        <span>本人排期 <strong>{scheduleLabel(order.personalSchedule)}</strong></span>
        <Button onClick={() => { setSavedSchedule(false); setEditing(true); }}>调整本人排期</Button>
      </Flex>
      {savedSchedule ? <Alert type="success" showIcon role="status" title="本人排期已保存" /> : null}
      <Flex gap="small" align="center" wrap><StatusLabel order={order} /><PersonalProgress order={order} /></Flex>
      {isGiftAssignment(order) && "segments" in order ? <>
        <Button onClick={() => setDiary(true)}>我的日报</Button>
        <GiftSettlementCard key={route} route={route} revision={attempt} role="member" />
        {order.segments.map(segment => <Card key={segment.segmentIndex} size="small" title={`第 ${segment.segmentIndex + 1} 段 · 本人份额`}>
          <Flex vertical gap="middle">
            {segment.shares.map(share => <section key={share.id} className="assignment-share">
              <Typography.Text strong>{share.kind === "directed" ? "定向承接" : "公开承接"} · {share.netGiftTimes} 次{share.transferredGiftTimes ? ` · 已改派 ${share.transferredGiftTimes} 次` : ""}</Typography.Text>
              <div className="club-order-number">份额 {share.id}</div>
              <GiftSchedule schedule={share.schedule} />
              <GiftExecutionAccounts orderRoute={route} share={share}
                readOnly={!order.giftProgress.canSubmitDaily || !share.schedule.length} onSaved={reload} />
            </section>)}
          </Flex>
        </Card>)}
        {diary && <GiftDeliveryDiary personal order={order} orderRoute={route} onClose={() => setDiary(false)} onSaved={reload} />}
      </> : <HistoricalShares order={order} />}
    </Flex>}
    {order && editing && <PersonalScheduleDialog route={route} orderName={order.recipientGameAccount} schedule={order.personalSchedule}
      onClose={() => setEditing(false)} onReload={() => { setEditing(false); reload(); }}
      onSaved={schedule => {
        setOrder(previous => previous && { ...previous, personalSchedule: schedule });
        setEditing(false);
        setSavedSchedule(true);
        onScheduleSaved(schedule);
      }} />}
  </Card>;
}

function HistoricalShares({ order }: { order: AssignedOrder | GiftAssignmentDetail }) {
  if (isGiftAssignment(order)) return null;
  return <Card size="small" title="历史按颗承接">
    <ul className="club-share-list">{order.shares.map(share => <li key={share.id}>
      <span>{share.hearts} 颗 · <code className="club-order-number">{share.id}</code></span>
      <span>{share.executionGameAccounts.map(account => account.name).join("、")}</span>
    </li>)}</ul>
  </Card>;
}
