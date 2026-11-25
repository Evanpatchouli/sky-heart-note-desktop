import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Spin, Typography } from "antd";
import { clubSettlementPostingLabel, formatCentsAsYuan, type ClubBalance } from "@webapp-template/common";
import { getClubBalance } from "@/api/club-finance.api";

const money = (cents: number) => `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;

export default function ClubBalanceCard() {
  const [data, setData] = useState<ClubBalance>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    getClubBalance().then(value => { if (active) setData(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);

  return <Card size="small" title="团费已入账余额" extra={<Button size="small" onClick={() => setAttempt(value => value + 1)}>刷新团费</Button>}>
    {error ? <Alert type="error" showIcon title="团费余额加载失败" /> : !data ? <Spin aria-label="加载团费余额" /> :
      <Flex vertical gap="small">
        <Typography.Title level={4} style={{ margin: 0 }}>{money(data.balanceCents)}</Typography.Title>
        {data.entries.length ? <details>
          <summary>入账流水</summary>
          <Flex vertical gap="small" style={{ marginTop: 8 }}>
            {data.entries.map(entry => <section key={entry.eventId}>
              <Typography.Text strong>{entry.kind === "member_penalty" ? "罚款收入" : entry.kind === "customer_compensation" ? "额外补偿实退" :
                entry.kind === "compensation_cash_correction" ? "补偿实退更正" : clubSettlementPostingLabel[entry.kind]}
                {"correctionRequestId" in entry && entry.kind !== "compensation_cash_correction" ? "（日报更正）" : ""} · {money(entry.amountCents)}</Typography.Text>
              <div>{entry.reason} · {new Date(entry.occurredAt).toLocaleString("zh-CN")}</div>
              {entry.orderId ? <Typography.Text type="secondary" copyable>{entry.orderId}</Typography.Text> : null}
            </section>)}
          </Flex>
        </details> : <Empty description="暂无入账流水" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Flex>}
  </Card>;
}
