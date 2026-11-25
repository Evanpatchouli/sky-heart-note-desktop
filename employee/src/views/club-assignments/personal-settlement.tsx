import { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Flex, Spin, Tag, Typography } from "antd";
import { formatCentsAsYuan, settlementIssueLabel, type PersonalSettlement } from "@webapp-template/common";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "./types";

function money(cents: number | null) {
  return cents === null ? "待核对" : `¥${formatCentsAsYuan(cents)}`;
}

export default function PersonalSettlementCard({ route, revision, role }: {
  route: string;
  revision: number;
  role: "member" | "dispatcher";
}) {
  const [data, setData] = useState<PersonalSettlement>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<PersonalSettlement>(`${route}/settlement`, "GET", undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => {
        if (!controller.signal.aborted) {
          setData(undefined);
          setError(requestMessage(err));
        }
      });
    return () => controller.abort();
  }, [route, revision, attempt]);

  const member = role === "member" ? data?.member : null;
  const dispatch = role === "dispatcher" ? data?.dispatch : null;
  const discountPending = member?.issues.includes("discount_cost_pending") || dispatch?.discountCostPending;
  return <Card size="small" title={role === "member" ? "本人送心核算" : "本人派单核算"}
    extra={<Button onClick={() => setAttempt(value => value + 1)}>刷新核算</Button>}>
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载核算" /> : null}
    {member || dispatch ? <Flex vertical gap="small">
      <div><Tag color={data?.finalCalculation ? "green" : "blue"}>
        {data?.finalCalculation ? "最终计算已生成" : data?.stopped ? "停送后核算" : "预计核算"}
      </Tag>{data?.finalCalculation ? <><Tag>业务复核待确认</Tag><Tag>未入账</Tag></> : null}</div>
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" items={member ? [
        { key: "reward", label: discountPending ? "按折前单价试算的送心报酬" : "已明确实绩的送心报酬", children: money(member.rewardCents) },
        { key: "total", label: discountPending ? "折前实绩小计" : member.issues.length ? "可核算实绩小计" : "已明确实绩合计", children: money(member.knownSubtotalCents) },
        ...(member.issues.length ? [{ key: "unknown", label: "本人应得合计", children: money(member.totalCents) }] : []),
        ...(data?.stopped ? [] : [{ key: "planned", label: `承接 ${member.claimedHearts} 颗如期送完的${discountPending ? "折前" : "预计"}送心报酬`,
          children: member.plannedRewardCents === null ? "按分段实绩待核对" : money(member.plannedRewardCents) }]),
      ] : dispatch ? [
        { key: "dispatch", label: discountPending ? "折前实绩派抽" : "已明确实绩对应的派抽", children: money(dispatch.feeCents) },
        ...(data?.stopped ? [] : [{ key: "planned", label: discountPending ? "按发布报价完成全单预计折前派抽" : "按发布报价完成全单预计派抽", children: money(dispatch.plannedFeeCents) }]),
        ...(discountPending ? [{ key: "unknown", label: "本人派抽净额", children: money(null) }] : []),
      ] : []} />
      {member?.segments.length ? <ul className="club-share-list">
        {member.segments.map(segment => <li key={segment.number}>
          第 {segment.number} 段 · 到账 {segment.receivedHearts} 颗 / 赠送 {segment.giftTimes} 次 · {money(segment.rewardCents)}
        </li>)}
      </ul> : null}
      {member?.issues.length ? <Alert type="warning" showIcon title="本人待核对事项"
        description={member.issues.map(issue => settlementIssueLabel[issue]).join("、")} /> : null}
      {dispatch?.discountCostPending ? <Alert type="warning" showIcon title={settlementIssueLabel.discount_cost_pending} /> : null}
      {data?.finalCalculation ? null : <Typography.Text type="secondary">
        实绩按有效日报及发布时约定核算。{data?.stopped ? "" : "完单预计按已明确的派发条件估算。"}
      </Typography.Text>}
    </Flex> : null}
  </Card>;
}
