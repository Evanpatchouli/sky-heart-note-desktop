import { formatCentsAsYuan, giftSettlementStatusLabel, type CustomerGiftSettlement } from "@webapp-template/common";

export function OrderGiftSettlement({ value, showTerminationEvidence = true }: {
  value: CustomerGiftSettlement;
  showTerminationEvidence?: boolean;
}) {
  const { cash, termination } = value;
  const money = (cents: number | null) => cents === null ? "待核对" : `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;
  return <section aria-label="本单结算状态">
    <h3>本单结算状态</h3>
    <p><strong>{giftSettlementStatusLabel[value.status]}</strong></p>
    {cash ? <dl>
      <dt>原实收</dt><dd>{money(cash.originalReceivedCents)}</dd>
      {cash.continuationReceivedCents ? <><dt>续段实收</dt><dd>{money(cash.continuationReceivedCents)}</dd></> : null}
      {cash.supplementReceivedCents ? <><dt>改价实补</dt><dd>{money(cash.supplementReceivedCents)}</dd></> : null}
      {cash.refundDueCents || cash.refundedCents ? <>
        <dt>应退</dt><dd>{money(cash.refundDueCents)}</dd>
        <dt>实退</dt><dd>{money(cash.refundedCents)}</dd>
        <dt>待退</dt><dd>{money(cash.refundRemainingCents)}</dd>
      </> : null}
      {cash.compensationRefundDueCents !== undefined ? <>
        <dt>其中额外补偿应退</dt><dd>{money(cash.compensationRefundDueCents)}</dd>
        <dt>其中额外补偿实退</dt><dd>{money(cash.compensationRefundedCents ?? null)}</dd>
        <dt>其中额外补偿待退</dt><dd>{money(cash.compensationRefundRemainingCents ?? null)}</dd>
      </> : null}
      <dt>净实收</dt><dd>{money(cash.netReceivedCents)}</dd>
    </dl> : null}
    {showTerminationEvidence && termination ? <details>
      <summary>停送与退款记录</summary>
      <p>停送时间 {new Date(termination.stoppedAt).toLocaleString("zh-CN")}</p>
      {termination.change?.reason ?? termination.reason}
      {termination.refunds.length ? <ul>
        {termination.refunds.map((payment, index) => <li key={index}>
          实退 {money(payment.amountCents)} · {new Date(payment.occurredAt).toLocaleString("zh-CN")}
        </li>)}
      </ul> : null}
    </details> : null}
  </section>;
}
