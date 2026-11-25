import { Flex, Tag, Typography } from "antd";
import {
  deliveryPeriodPreferenceLabel, formatCentsAsYuan, type DeliveryPeriodBreakdown,
} from "@sky-club/common";

export const actualPeriodLabels = { ...deliveryPeriodPreferenceLabel, unconfirmed: "时段待核对" };

export default function ClubDeliveryPeriods({ breakdown, segmentPrices, segmentsOverPlan, personal = false, stopped = false }: {
  breakdown: DeliveryPeriodBreakdown;
  segmentPrices?: number[];
  segmentsOverPlan?: number[];
  personal?: boolean;
  stopped?: boolean;
}) {
  const unlinked = breakdown.links.filter(link => !link.matchesQuote);
  return <Flex vertical gap="small">
    <Typography.Text strong>{personal ? "本人分期实绩" : "分期实绩"}</Typography.Text>
    <dl className="club-order-facts">
      {breakdown.periods.filter(row => row.period !== "unconfirmed" || row.giftTimes || row.receivedHearts).map(row =>
        <div key={row.period}>
          <dt>{actualPeriodLabels[row.period]}</dt>
          <dd>{row.giftTimes} 次 · 到账 {row.receivedHearts} 颗</dd>
        </div>
      )}
    </dl>
    {breakdown.segments.length ? <>
      <Typography.Text strong>{personal ? "全单计价段与本人实绩" : "计价段与分段实绩"}</Typography.Text>
      <ul className="club-share-list">
        {breakdown.segments.map(segment => {
          const unitPrice = segmentPrices?.[segment.number - 1];
          return <li key={segment.number}>
            <Flex vertical gap={4}>
              <strong>{segment.adjusted ? "商定续送" : "原报价"}第 {segment.number} 段 · {actualPeriodLabels[segment.period]}</strong>
              <Flex wrap gap="small">
                <span>计划 {segment.plannedHearts} 颗
                  {segment.giftHearts ? `（付费 ${segment.paidHearts} · 赠心 ${segment.giftHearts}）` : ""}
                </span>
                {unitPrice !== undefined ? <span>{formatCentsAsYuan(unitPrice)} 元/颗</span> : null}
                <span>{personal ? "本人已对应" : "已对应"} {segment.receivedHearts} 颗 · {segment.giftTimes} 次</span>
                {segment.pendingHearts !== null ? <span>{stopped ? "本段原未履约" : "本段剩余"} {segment.pendingHearts} 颗</span> : null}
                {(personal ? segmentsOverPlan?.includes(segment.number)
                  : BigInt(segment.receivedHearts) > BigInt(segment.plannedHearts)) ?
                  <Tag color="warning">{personal ? "全单超出原段计划" : "超出原段计划"}</Tag> : null}
              </Flex>
            </Flex>
          </li>;
        })}
      </ul>
    </> : <Typography.Text type="secondary">暂无可用的原报价段。</Typography.Text>}
    {unlinked.length ? <>
      <Typography.Text strong>报价段关联待核对</Typography.Text>
      <ul className="club-report-terms">
        {unlinked.map(row => <li key={`${row.period}:${row.quoteSegment}`}>
          {actualPeriodLabels[row.period]} · {row.quoteSegment === null ? "未选报价段" : `日报选填第 ${row.quoteSegment} 段`}
          {" · "}{row.giftTimes} 次 · 到账 {row.receivedHearts} 颗
        </li>)}
      </ul>
    </> : null}
  </Flex>;
}
