import { formatCentsAsYuan, type GiftPerformance } from "@webapp-template/common";

export const giftPeriodLabels = { normal: "普通期", double: "双倍期", unconfirmed: "实际时段待核对" };

export function giftHearts(value: number | string | null) {
  return value === null ? "未知" : `${value} 颗`;
}

export function giftMoney(value: number | null) {
  return value === null ? "待核对" : `¥${formatCentsAsYuan(value)}`;
}

export function GiftPeriodFacts({ performance }: { performance: GiftPerformance }) {
  return <>
    {performance.periods.length > 0 && <ul>
      {performance.periods.map(period => <li key={period.period}>
        {giftPeriodLabels[period.period]} · 实报 {period.observedGiftTimes} 次 · 计入约定 {period.deliveredGiftTimes ?? "待核对"}{period.deliveredGiftTimes === null ? "" : " 次"}
        <br />按实际时段预计 {giftHearts(period.estimatedDeliveredHearts)} · 日报到账 {giftHearts(period.actualReceivedHearts)}
        {period.unknownReceivedLines > 0 && `（${period.knownReceivedLines > 0 ? `已知 ${giftHearts(period.knownReceivedHearts)}，` : ""}${period.unknownReceivedLines} 条未知）`}
        <br />爱心款依据 {giftMoney(period.heartAmountCents)}
      </li>)}
    </ul>}
    {performance.excessGiftTimes !== 0 && <p>份额外实报 {performance.excessGiftTimes} 次待业务核对。</p>}
  </>;
}
