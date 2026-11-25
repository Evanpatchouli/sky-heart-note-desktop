import { Button, Flex, Form, Input, Modal, Select, Typography } from "antd";
import type { QuoteSegment, ReportLine, ReportRecord } from "./types";

export const periodLabels = { normal: "普通期", double: "双倍期", unconfirmed: "实际时段待核对" };
export const reportLabels = { daily: "填报日报", supplement: "补报漏填日期", correction: "申请更正" };

export type ReportDraft = { kind: "daily" | "supplement" } | { kind: "correction"; record: ReportRecord };
type Fields = {
  target: string;
  businessDate: string;
  reason?: string;
  lines: { term: string; giftTimes: string; receivedHearts: string }[];
};

export function segmentLabel(segment: QuoteSegment) {
  return `${segment.adjusted ? "商定续送" : ""}第 ${segment.number} 段 · ${periodLabels[segment.period]}`;
}

export default function DeliveryReportForm({ draft, accounts, segments, recipient, onCancel, onSubmit }: {
  draft: ReportDraft;
  accounts: { value: string; label: string }[];
  segments: readonly QuoteSegment[];
  recipient: string;
  onCancel: () => void;
  onSubmit: (values: Omit<Fields, "lines"> & { lines: ReportLine[] }) => void;
}) {
  const [form] = Form.useForm<Fields>();
  const original = draft.kind === "correction" ? draft.record : undefined;
  const findSegment = (term: string) => segments.find(segment => String(segment.number) === term);
  const initialLines = original?.lines.map(line => {
    const segment = line.quoteSegment === undefined ? undefined : segments[line.quoteSegment - 1];
    return {
      term: segment?.period === line.period ? String(segment.number) : line.period,
      giftTimes: String(line.giftTimes),
      receivedHearts: String(line.receivedHearts),
    };
  }) ?? [{}];
  const terms = [
    ...segments.map(segment => ({ value: String(segment.number), label: `${segmentLabel(segment)} · 预计 ${segment.hearts} 颗` })),
    { value: "normal", label: "实际普通期 · 对应报价段待核对" },
    { value: "double", label: "实际双倍期 · 对应报价段待核对" },
    { value: "unconfirmed", label: "实际时段待核对" },
  ];
  const numericRule = {
    required: true,
    validator: (_: unknown, value: unknown) =>
      typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
        ? Promise.resolve() : Promise.reject(new Error("请输入非负整数")),
  };

  return <Modal open title={reportLabels[draft.kind]} onCancel={onCancel} onOk={() => form.submit()}
    okText={draft.kind === "daily" ? "确认提交日报" : "提交待核对"} cancelText="取消">
    <Typography.Paragraph style={{ overflowWrap: "anywhere" }}>接收游戏账号 {original?.recipientGameAccount ?? recipient}</Typography.Paragraph>
    {original ? <Typography.Paragraph>
      送心号 {original.accountName}{original.accountLocalId ? ` · #${original.accountLocalId}` : ""}<br />
      业务日期 {original.businessDate} · 更正第 {original.version} 版
    </Typography.Paragraph> : null}
    <Form form={form} layout="vertical" initialValues={{ lines: initialLines, target: accounts.length === 1 ? accounts[0].value : undefined }}
      onFinish={values => {
        const lines = values.lines.map(({ term, giftTimes, receivedHearts }) => {
          const segment = findSegment(term);
          return {
            period: segment?.period ?? term as ReportLine["period"],
            quoteSegment: segment?.number,
            giftTimes: Number(giftTimes),
            receivedHearts: Number(receivedHearts),
          };
        });
        if (!Number.isSafeInteger(lines.reduce((sum, line) => sum + line.receivedHearts, 0))) {
          form.setFields([{ name: "lines", errors: ["实际到账合计超出整数范围"] }]);
          return;
        }
        onSubmit({ ...values, lines });
      }}>
      {original ? null : <>
        <Form.Item name="target" label="本人份额与送心号" rules={[{ required: true, message: "请选择送心号" }]}>
          <Select options={accounts} placeholder="选择已关联的账号" />
        </Form.Item>
        <Form.Item name="businessDate" label="业务日期" rules={[{ required: true, message: "请填写业务日期" }]}>
          <Input type="date" />
        </Form.Item>
      </>}
      <Typography.Paragraph type="secondary">
        {draft.kind === "daily" ? "请按实际情况填写次数与到账。零到账也可登记。" : "提交后可在历史查看申请，当前进度以已登记实绩为准。"}
      </Typography.Paragraph>
      <Form.List name="lines">{(fields, { add, remove }, { errors }) => <>
        {fields.map((field, index) => <fieldset key={field.key} className="club-report-period">
          <legend>实际时段 {index + 1}</legend>
          <Form.Item name={[field.name, "term"]} label="适用时段或原报价段"
            rules={[{ required: true, message: "请选择适用时段" }]}>
            <Select options={terms} placeholder="选择实际时段" />
          </Form.Item>
          <div className="club-report-counts">
            <Form.Item name={[field.name, "giftTimes"]} label="实际赠送次数" rules={[numericRule]}>
              <Input inputMode="numeric" />
            </Form.Item>
            <Form.Item name={[field.name, "receivedHearts"]} label="实际到账颗数" rules={[numericRule]}>
              <Input inputMode="numeric" />
            </Form.Item>
          </div>
          {fields.length > 1 ? <Button size="small" onClick={() => remove(field.name)}>移除此时段</Button> : null}
        </fieldset>)}
        <Flex vertical align="start" gap="small">
          <Form.ErrorList errors={errors} />
          <Button onClick={() => add()}>添加实际时段</Button>
        </Flex>
      </>}</Form.List>
      <Form.Item name="reason" label={draft.kind === "daily" ? "情况说明（选填）" : "原因"}
        style={{ marginTop: 16, marginBottom: 0 }}
        rules={draft.kind === "daily" ? undefined : [{ required: true, whitespace: true, message: "请填写原因" }]}>
        <Input.TextArea rows={2} maxLength={240} />
      </Form.Item>
    </Form>
  </Modal>;
}
