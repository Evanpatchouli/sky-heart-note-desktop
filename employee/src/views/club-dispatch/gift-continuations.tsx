import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Flex, Form, Input, Typography } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, type ContinuationQuote, type ContinuationRequest, type GiftWindow } from "@webapp-template/common";
import { RequestError } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

const periods = { normal: "普通期", double: "双倍期" };
const money = (amount: number) => `¥${formatCentsAsYuan(amount)}`;

export function GiftContinuationManagement({ route, requests, quotes, enabled, onChange }: {
  route: string;
  requests: ContinuationRequest[];
  quotes: ContinuationQuote[];
  enabled: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const pending = useRef(new Map<string, string>());
  const waiting = requests.filter(request => !quotes.some(quote => quote.customerRequestId === request.requestId));

  async function write(suffix: string, input: object, method: "POST" | "PATCH" = "POST") {
    if (inFlight.current) return;
    setError("");
    setBusy(true);
    inFlight.current = true;
    const key = JSON.stringify([suffix, input]);
    let requestId = pending.current.get(key);
    if (!requestId) {
      requestId = crypto.randomUUID();
      pending.current.set(key, requestId);
    }
    try {
      await employeeRequest(route + suffix, method, method === "POST" ? { ...input, requestId } : input);
      pending.current.delete(key);
      onChange();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到处理结果，请用原内容重试");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section aria-label="续段处理">
    <Typography.Title level={5}>续段处理</Typography.Title>
    <Button onClick={onChange} disabled={busy}>刷新续段记录</Button>
    {error && <Alert type="error" showIcon title={error} />}
    {!waiting.length && !quotes.length && <p>暂无续段需求或报价。</p>}
    {waiting.map(request => <div key={request.requestId}>
      <p>老板申请 · {periods[request.period]} · {request.paidGiftTimes} 次 · {request.dailyGiftTimes} 次/日
        {" · "}{request.startDate} 至 {request.endDate}</p>
      {enabled && <Form<{ price: string }> name={`continuation-price-${request.requestId}`} layout="inline" onFinish={({ price }) => {
        const unitPriceCents = parseYuanAsCents(price);
        if (!unitPriceCents) return setError("请填写有效的每次单价");
        const { period, paidGiftTimes, dailyGiftTimes } = request;
        void write("/continuation-quotes", {
          customerRequestId: request.requestId, segment: { period, paidGiftTimes, dailyGiftTimes, unitPriceCents },
        });
      }}>
        <Form.Item name="price" label="续段单价（元/次）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>发送续段报价</Button>
      </Form>}
    </div>)}
    {quotes.map(quote => <div key={quote.requestId}>
      <p>{quote.segmentIndex === undefined ? "" : `第 ${quote.segmentIndex + 1} 段 · `}
        {periods[quote.segment.period]} · {quote.segment.paidGiftTimes} 次 · {quote.segment.dailyGiftTimes} 次/日
        {" · "}{money(quote.segment.unitPriceCents)}/次 · 报价 {money(quote.amountCents)}</p>
      {quote.window && <p>执行 {quote.window.startDate} 至 {quote.window.endDate}</p>}
      {quote.receipt ? <p>已登记实收 {money(quote.receipt.receivedAmountCents)} · {new Date(quote.receipt.receivedAt).toLocaleString("zh-CN")}</p>
        : !quote.window ? <>
          <p>待补执行窗口</p>
          {enabled && <Form<GiftWindow> name={`continuation-window-${quote.requestId}`} layout="vertical"
            onFinish={input => void write(`/continuation-quotes/${quote.requestId}/window`, input, "PATCH")}>
            <Flex gap="small" wrap>
              <Form.Item name="startDate" label="续段起始日" rules={[{ required: true }]}><Input type="date" /></Form.Item>
              <Form.Item name="endDate" label="续段截止日" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            </Flex>
            <Button htmlType="submit" loading={busy}>登记续段窗口</Button>
          </Form>}
        </> : !quote.acceptance ? <p>待老板确认报价</p> : <>
          <p>老板已确认 · 待登记实际收款</p>
          {enabled && <Form<{ receivedAt: string; confirmed: boolean }> name={`continuation-receipt-${quote.requestId}`}
            layout="vertical" onFinish={({ receivedAt, confirmed }) => {
            const time = new Date(receivedAt);
            if (!confirmed || !Number.isFinite(time.getTime())) return setError("请确认实际收到全款并填写收款时间");
            void write(`/continuation-quotes/${quote.requestId}/receipt`, {
              receivedAmountCents: quote.amountCents, receivedAt: time.toISOString(),
            });
          }}>
            <Form.Item name="receivedAt" label="实际收款时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
            <Form.Item name="confirmed" valuePropName="checked"><Checkbox>确认已实际收到续段款 {money(quote.amountCents)}</Checkbox></Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>登记续段实收</Button>
          </Form>}
        </>}
    </div>)}
  </section>;
}
