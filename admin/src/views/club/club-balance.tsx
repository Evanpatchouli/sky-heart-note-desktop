import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Input, Spin, Typography } from "antd";
import { clubSettlementPostingLabel, formatCentsAsYuan, USER_ID_PATTERN, type ClubBalance } from "@sky-club/common";
import { getClubBalance } from "@/api/club-finance.api";

const money = (cents: number) => `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;

export default function ClubBalanceCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  return <Card size="small" title="入账流水">
    <Flex vertical gap="middle">
      <form onSubmit={event => { event.preventDefault(); if (USER_ID_PATTERN.test(query)) setMemberId(query); }}>
        <Flex wrap gap="small">
          <Input aria-label="团员四位 ID" placeholder="团员四位 ID" maxLength={4} value={query}
            style={{ width: 146 }} onChange={event => setQuery(event.target.value.trim().toUpperCase())} />
          <Button htmlType="submit" disabled={!USER_ID_PATTERN.test(query)}>查询个人流水</Button>
          {memberId ? <Button onClick={() => { setMemberId(""); setQuery(""); }}>查看团费流水</Button> : null}
        </Flex>
      </form>
      <BalanceEntries key={memberId} memberId={memberId} onOpen={onOpen} />
    </Flex>
  </Card>;
}

function BalanceEntries({ memberId, onOpen }: { memberId: string; onOpen: (id: string) => void }) {
  const [data, setData] = useState<ClubBalance>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getClubBalance(memberId).then(value => { if (active) setData(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [memberId, attempt]);

  return <section>
    <Flex wrap gap="small" align="center">
      <Typography.Text strong>{memberId ? `个人流水 · ${memberId}` : "团费已入账余额"}</Typography.Text>
      <Button size="small" onClick={() => { setError(false); setAttempt(value => value + 1); }}>刷新余额</Button>
    </Flex>
    {error ? <Alert type="error" showIcon title="余额加载失败" /> : !data ? <Spin aria-label="加载余额" /> :
      <Flex vertical gap="small">
        {!memberId || data.entries.length > 0 ? <Typography.Title level={4} style={{ margin: 0 }}>{money(data.balanceCents)}</Typography.Title> : null}
        {data.entries.length ? <details>
          <summary>入账流水</summary>
          <Flex vertical gap="small" style={{ marginTop: 8 }}>
            {data.entries.map(entry => <section key={entry.eventId}>
              <Typography.Text strong>{entry.kind === "member_penalty" ? (memberId ? "责任扣款" : "罚款收入") : entry.kind === "customer_compensation" ? "额外补偿实退" :
                entry.kind === "compensation_cash_correction" ? "补偿实退更正" : clubSettlementPostingLabel[entry.kind]}
                {"correctionRequestId" in entry && entry.kind !== "compensation_cash_correction" ? "（日报更正）" : ""} · {money(entry.amountCents)}</Typography.Text>
              <div>{entry.reason} · {new Date(entry.occurredAt).toLocaleString("zh-CN")}</div>
              {entry.orderId ? <Button type="link" size="small" onClick={() => onOpen(entry.orderId!)}>核对订单 {entry.orderId}</Button> : null}
            </section>)}
          </Flex>
        </details> : <Empty description={memberId ? "该 ID 未查到入账流水" : "暂无入账流水"} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Flex>}
  </section>;
}
