import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Descriptions, Flex, Modal, Spin, Tag, Typography } from "antd";
import { formatCentsAsYuan, giftSettlementStatusLabel, type GiftSettlementClose, type PersonalGiftSettlement } from "@webapp-template/common";
import { useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "./types";
import CashCorrections from "../club-financial/cash-corrections";

const money = (cents: number | null) => cents === null ? "待核对" :
  `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;

export default function GiftSettlementCard({ route, revision, role, showTerminationEvidence = true, onClosed }: {
  route: string;
  revision: number;
  role: "member" | "dispatcher";
  showTerminationEvidence?: boolean;
  onClosed?: () => void;
}) {
  const { token } = useAuthSession();
  const [state, setState] = useState<{ token: typeof token; data?: PersonalGiftSettlement; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const closeRequest = useRef<{ requestId: string; calculationId: string }>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<PersonalGiftSettlement>(`${route}/settlement`, "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ token, data }); })
      .catch(error => { if (!controller.signal.aborted) setState({ token, error: requestMessage(error) }); });
    return () => controller.abort();
  }, [route, revision, attempt, token]);

  const { data, error } = state?.token === token ? state ?? {} : {};
  const dispatch = role === "dispatcher" ? data?.dispatch : null;
  const member = role === "member" ? data?.member : null;
  const termination = showTerminationEvidence && role === "dispatcher" ? data?.termination : null;
  async function confirmClose() {
    const calculationId = data?.finalCalculation?.id;
    if (!data?.canClose || !calculationId || closing) return;
    if (closeRequest.current?.calculationId !== calculationId)
      closeRequest.current = { requestId: crypto.randomUUID(), calculationId };
    setClosing(true);
    setCloseError("");
    try {
      const close = await employeeRequest<GiftSettlementClose>(`${route}/settlement/close`, "POST", closeRequest.current);
      setState({ token, data: { ...data, status: "closed", canClose: false, close } });
      setConfirming(false);
      setAttempt(value => value + 1);
      onClosed?.();
    } catch (reason) {
      setCloseError(requestMessage(reason));
    } finally {
      setClosing(false);
    }
  }
  return <Card size="small" title={role === "dispatcher" ? "本人派单结算" : "本人送心结算"}
    extra={<Button size="small" onClick={() => setAttempt(value => value + 1)}>刷新核算</Button>}>
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载本人结算" /> :
      <Flex vertical gap="small">
        <div><Tag color={data.status === "ready_to_close" ? "green" : "blue"}>{giftSettlementStatusLabel[data.status]}</Tag>
          {data.status === "closed" ? <Tag color="green">已入账</Tag> : <Tag>未入账</Tag>}
          {data.stopped ? <Tag>已停送</Tag> : null}
        </div>
        {data.close ? <Typography.Text type="secondary">结单人 {data.close.closedByUserId} · {new Date(data.close.closedAt).toLocaleString("zh-CN")}</Typography.Text> : null}
        {role === "dispatcher" && data.canClose && data.finalCalculation ?
          <Button type="primary" onClick={() => { setCloseError(""); setConfirming(true); }}>确认结单</Button> : null}
        {role === "dispatcher" && data.close ? <CashCorrections orderRoute={route} onSaved={() => setAttempt(value => value + 1)} /> : null}
        {member ? <>
          <Descriptions size="small" column={1} items={[
            { key: "forecast", label: "按本人约定预计", children: money(member.plannedRewardCents) },
            { key: "reward", label: "按当前有效实绩", children: money(member.rewardCents) },
            ...(member.penaltyCents !== undefined ? [
              { key: "penalty", label: data.status === "closed" ? "本人扣款" : "本人已生效罚款（随结单扣记）", children: money(member.penaltyCents) },
              { key: "net", label: "本人实绩净额", children: money(member.netRewardCents ?? null) },
            ] : []),
            { key: "gifts", label: "计酬次数", children: `${member.deliveredGiftTimes} / ${member.agreedGiftTimes} 次` },
            { key: "observed", label: "日报实际赠送", children: `${member.observedGiftTimes} 次` },
            ...(member.excessGiftTimes ? [{ key: "excess", label: "超出计酬范围", children: `${member.excessGiftTimes} 次` }] : []),
            { key: "hearts", label: "实际到账", children: member.actualReceivedHearts == null
              ? (member.knownReceivedLines ? `部分未知 · 已知 ${member.knownReceivedHearts} 颗` : "未知")
              : `${member.actualReceivedHearts} 颗` },
          ]} />
          {member.segments.map(segment => <Typography.Text key={segment.segmentIndex}>
            第 {segment.segmentIndex + 1} 段 · {money(segment.unitPriceCents)}/次 · 计酬 {segment.deliveredGiftTimes} 次 · {money(segment.rewardCents)}
          </Typography.Text>)}
        </> : null}
        {dispatch ? <Descriptions size="small" column={1} items={[
          { key: "forecast", label: "按全单约定预计净派抽", children: money(dispatch.plannedNetCents) },
          { key: "fee", label: "实绩派抽原额", children: money(dispatch.feeCents) },
          { key: "discount", label: "兑现个人让利", children: money(dispatch.personalDiscountCents) },
          { key: "net", label: "当前净派抽", children: money(dispatch.netCents) },
        ]} /> : null}
        {termination ? <details>
          <summary>停送与退款依据</summary>
          <Descriptions size="small" column={1} items={[
            { key: "receipt", label: "原实收", children: money(termination.originalReceivedCents) },
            { key: "due", label: "应退", children: money(termination.refundDueCents) },
            { key: "paid", label: "实退", children: money(termination.refundedCents) },
            { key: "remaining", label: "待退", children: money(termination.refundRemainingCents) },
            { key: "net", label: "净实收", children: money(termination.netReceivedCents) },
          ]} />
          {termination.change?.reason ?? termination.reason}
          {termination.refunds.map(payment => <div key={payment.requestId}>
            {money(payment.amountCents)} · {new Date(payment.occurredAt).toLocaleString("zh-CN")} · 经手人 {payment.recordedByUserId}
          </div>)}
        </details> : null}
        {(member?.penalties ?? (role === "dispatcher" ? data.penalties : undefined))?.map(penalty =>
          <Typography.Text key={penalty.id}>本人罚款 {money(penalty.amountCents)} · {penalty.reason}</Typography.Text>)}
      </Flex>}
    {confirming ? <Modal open title="确认结单" okText="确认结单并入账" cancelText="取消"
      confirmLoading={closing} onOk={() => void confirmClose()} onCancel={() => { if (!closing) setConfirming(false); }}>
      <Typography.Paragraph>按当前计算单将派抽、送心报酬和团费记账。结单后，日报及现金登记的更正须经团长或副团长确认。</Typography.Paragraph>
      {closeError ? <Alert type="error" showIcon title={closeError} /> : null}
    </Modal> : null}
  </Card>;
}
