import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Spin, Typography } from "antd";
import { clubPenaltyPostingLabel, clubSettlementPostingLabel, type PersonalClubBalance } from "@sky-club/common";
import { useAuthSession } from "@sky-club/common/web-auth";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { money, showDate } from "./adjustment-summary";

export default function MemberBalance() {
  const { token } = useAuthSession();
  return <>
    <Header />
    <main className="club-claim-page">
      <Typography.Title level={2}>个人余额</Typography.Title>
      <BalanceEntries key={token} />
    </main>
  </>;
}

function BalanceEntries() {
  const [data, setData] = useState<PersonalClubBalance>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<PersonalClubBalance>("club/balance", "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [attempt]);

  return <Flex vertical gap="middle"><Card size="small" title="已入账余额" extra={<Button onClick={() => setAttempt(value => value + 1)}>刷新余额</Button>}>
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载余额" /> :
      <Flex vertical gap="middle">
        <Typography.Title level={3} style={{ margin: 0 }}>{money(data.balanceCents)}</Typography.Title>
        {data.entries.length ? data.entries.map(entry => <Card size="small" key={entry.eventId}>
          <Flex vertical>
            <Typography.Text strong>{entry.kind === "member_penalty" ? "已生效罚款" : entry.kind === "customer_compensation" ? "额外补偿实退" :
              entry.kind === "compensation_cash_correction" ? "补偿实退更正" : clubSettlementPostingLabel[entry.kind]}
              {"correctionRequestId" in entry && entry.kind !== "compensation_cash_correction" ? "（日报更正）" : ""} · {money(entry.amountCents)}</Typography.Text>
            <Typography.Text>{entry.reason}</Typography.Text>
            {entry.orderId ? <Typography.Text type="secondary" copyable>{entry.orderId}</Typography.Text> : null}
            <Typography.Text type="secondary">{showDate(entry.occurredAt)}</Typography.Text>
          </Flex>
        </Card>) : <Empty description="暂无入账流水" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Flex>}
  </Card>
    {!error && data?.pendingPenalties.length ? <Card size="small" title="未入账的罚款">
      <Flex gap="small" vertical>{data.pendingPenalties.map(penalty => <div key={penalty.id}>
        <Typography.Text strong>{money(penalty.amountCents)} · {penalty.reason}</Typography.Text>
        <div>{clubPenaltyPostingLabel[penalty.penaltyPosting]}</div>
        {penalty.decidedAt ? <div>{showDate(penalty.decidedAt)}</div> : null}
      </div>)}</Flex>
    </Card> : null}
  </Flex>;
}
