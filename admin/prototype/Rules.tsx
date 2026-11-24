import { useState } from "react";
import { Alert, App, Button, Card, Descriptions, Flex, Form, Grid, InputNumber, Modal, Radio, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { money, saveRules, useClub } from "./club";

type Snapshot = ReturnType<typeof useClub>["orders"][number];
type Basis = "到账颗数" | "赠送次数";
type EditValues = { basis: Basis; amount: string | null };

function unit(basis: string) { return basis === "赠送次数" ? "次" : "颗"; }

function cents(raw: string | null | undefined) {
  if (raw == null || !/^\d+(?:\.\d{1,2})?$/.test(String(raw))) return null;
  const result = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(result) ? result : null;
}

export default function Rules() {
  const { rules, orders } = useClub();
  const { message } = App.useApp();
  const { md } = Grid.useBreakpoint();
  const [form] = Form.useForm<EditValues>();
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  const basis = Form.useWatch("basis", form) ?? rules.basis;
  const amount = cents(Form.useWatch("amount", form));
  const published = orders.filter(order => order.status !== "pending");
  const ordered = [...published].sort((a, b) => a.id.localeCompare(b.id, "zh-CN", { numeric: true }) * -1);
  const unchanged = basis === rules.basis && amount === rules.clubFee;

  function openForm() {
    setSaveError("");
    setEditVersion(rules.version);
    form.setFieldsValue({ basis: rules.basis, amount: (rules.clubFee / 100).toFixed(2) });
  }

  function submit(values: EditValues) {
    const fee = cents(values.amount);
    if (fee === null) return;
    if (rules.version !== editVersion) {
      setSaveError("规则已更新，请关闭弹窗，核对当前版本后重试。");
      return;
    }
    try {
      saveRules(values.basis, fee);
      setEditVersion(null);
      void message.success("新规则已启用");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
    }
  }

  const columns: TableColumnsType<Snapshot> = [
    {
      title: "订单", key: "order",
      render: (_, order) => <div><Typography.Text>{order.title}</Typography.Text><br />
        <Typography.Text type="secondary">{order.id}</Typography.Text></div>,
    },
    { title: "来源", dataIndex: "source", responsive: ["lg"] },
    { title: "派单人", dataIndex: "dispatcher", responsive: ["md"] },
    { title: "计抽口径", dataIndex: "basis", render: (value: string) => <Tag color="blue">{value}</Tag> },
    { title: "版本", dataIndex: "ruleVersion", responsive: ["lg"], render: (v: number) => `V${v}` },
    {
      title: "派抽", key: "dispatchFee", align: "right", responsive: ["md"],
      render: (_, order) => `${money(order.dispatchFee)}/${unit(order.basis)}`,
    },
    { title: "团抽", key: "clubFee", align: "right", render: (_, order) => `${money(order.clubFee)}/${unit(order.basis)}` },
  ];

  return (
    <section className="review-page" aria-label="抽成规则">
      <Typography.Title level={4}>抽成规则</Typography.Title>
      <Card title="当前规则" extra={<Button type="primary" icon={<EditOutlined />} onClick={openForm}>编辑规则</Button>}>
        <Descriptions size="small" column={md ? 3 : 1} items={[
          { key: "version", label: "规则版本", children: <Tag color="green">V{rules.version} 生效中</Tag> },
          { key: "basis", label: "派抽、团抽共用口径", children: rules.basis },
          { key: "fee", label: "团抽金额", children: `${money(rules.clubFee)}/${unit(rules.basis)}` },
        ]} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          派单人设置本单派抽。订单正式派发时保存计抽口径、派抽和团抽，后续按该单的记录复算。
        </Typography.Paragraph>
      </Card>
      <Typography.Title level={5}>已派发订单的规则快照</Typography.Title>
      <Table<Snapshot> rowKey="id" columns={columns} dataSource={ordered}
        expandable={md ? undefined : {
          columnWidth: 32,
          expandedRowRender: order => <Descriptions size="small" column={1} items={[
            { key: "source", label: "订单来源", children: order.source },
            { key: "version", label: "版本", children: `V${order.ruleVersion}` },
            { key: "dispatcher", label: "派单人", children: order.dispatcher },
            { key: "fee", label: "派抽", children: `${money(order.dispatchFee)}/${unit(order.basis)}` },
          ]} />,
        }}
        pagination={{ pageSize: 5, showSizeChanger: false, showTotal: total => `共 ${total} 笔` }} />

      <Modal title="编辑抽成规则" open={editVersion !== null} forceRender
        onCancel={() => setEditVersion(null)} onOk={() => form.submit()}
        okText="确认启用" cancelText="取消" okButtonProps={{ disabled: unchanged }}>
        <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 20 }}>
          <Form.Item name="basis" label="派抽、团抽共用计量口径" rules={[{ required: true, message: "请选择计量口径" }]}>
            <Radio.Group>
              <Radio value="到账颗数">按实际到账颗数</Radio>
              <Radio value="赠送次数">按赠送次数</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="amount" label={`团抽金额（元/${unit(basis)}）`} rules={[
            { required: true, message: "请填写团抽金额" },
            { validator: (_, value: string | null) => value == null || cents(value) !== null ? Promise.resolve() : Promise.reject(new Error("请填写非负金额，最多两位小数")) },
          ]}>
            <InputNumber<string> stringMode step="0.01" changeOnBlur={false} inputMode="decimal" style={{ width: "100%" }} />
          </Form.Item>
          <Flex vertical gap="small">
            {amount !== null && Number.isSafeInteger(amount * 200) && <Typography.Text>
              双倍期赠送 100 次、到账 200 颗时，本单团抽为 {money(amount * (basis === "到账颗数" ? 200 : 100))}。
            </Typography.Text>}
            <Alert type="info" showIcon title="生效范围" description="确认后仅新派发的订单使用本次配置，已派发订单继续使用原快照。" />
            {saveError && <Alert type="error" showIcon title={saveError} role="alert" />}
          </Flex>
        </Form>
      </Modal>
    </section>
  );
}
