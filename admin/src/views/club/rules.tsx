import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { Alert, Button, Card, Descriptions, Empty, Flex, Form, Grid, InputNumber, Modal, Spin, Table, Tag, Typography, type TableColumnsType } from "antd";
import { EditOutlined } from "@ant-design/icons";
import {
  commissionBasisLabel, commissionUnit, formatCentsAsYuan, parseYuanAsCents,
  type CommissionBasis, type CommissionRule,
} from "@webapp-template/common";
import { getCommissionRule, getDispatchHistory, saveCommissionRule, type AdminClub, type DispatchPricingRow } from "@/api/club.api";
import type { AdminClubContext } from "../home";
import ClubPromotions from "./promotions";

type RuleFields = { amount: string | null };

function fee(cents: number, basis: CommissionBasis) {
  return `¥${formatCentsAsYuan(cents)}/${commissionUnit(basis)}`;
}

function errorText(error: unknown, fallback: string) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}

export default function Rules() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const selected = club?.permissions.includes("CLUB_COMMISSION_MANAGE") ? club : null;

  return <Flex vertical gap="middle" aria-label="抽成规则">
    <Typography.Title level={4} style={{ margin: 0 }}>抽成规则</Typography.Title>
    {loadFailed ? <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />
      : club === undefined ? <Spin aria-label="加载俱乐部" />
      : selected ? <>
        <Typography.Text strong>{selected.name}</Typography.Text>
        <ClubRules club={selected} />
        <ClubPromotions />
      </> : <Empty description="当前账号未获团抽配置权限" />}
  </Flex>;
}

function ClubRules({ club }: { club: AdminClub }) {
  const [rule, setRule] = useState<CommissionRule | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form] = Form.useForm<RuleFields>();
  const cents = parseYuanAsCents(Form.useWatch("amount", form));
  const { md } = Grid.useBreakpoint();

  useEffect(() => {
    let active = true;
    setLoadError("");
    getCommissionRule().then(data => {
      if (active) setRule(data);
    }).catch(error => {
      if (active) setLoadError(errorText(error, "抽成规则加载失败"));
    });
    return () => { active = false; };
  }, [attempt]);

  function openForm() {
    setSaveError("");
    setSaved(false);
    setEditVersion(rule?.version ?? 0);
    form.setFieldsValue({ amount: rule?.basis === "gift_times" ? formatCentsAsYuan(rule.clubFeeCents) : null });
  }

  async function submit(values: RuleFields) {
    const amount = parseYuanAsCents(values.amount);
    if (amount === null || editVersion === null || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const data = await saveCommissionRule({ expectedVersion: editVersion, clubFeeCents: amount });
      setRule(data);
      setEditVersion(null);
      setSaved(true);
    } catch (error) {
      setSaveError(errorText(error, "规则保存失败"));
      if (error && typeof error === "object" && "status" in error && error.status === 409) {
        setAttempt(value => value + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Card title="当前规则" extra={rule !== undefined && !loadError
      ? <Button type="primary" icon={<EditOutlined />} onClick={openForm}>{rule ? "编辑规则" : "配置规则"}</Button> : undefined}>
      {loadError ? <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
        : rule === undefined ? <Spin aria-label="加载抽成规则" />
        : rule ? <Descriptions size="small" column={md ? 3 : 1} items={[
          { key: "version", label: "规则版本", children: <Tag color={rule.basis === "gift_times" ? "green" : "default"}>V{rule.version} {rule.basis === "gift_times" ? "生效中" : "历史按颗规则"}</Tag> },
          { key: "basis", label: "抽成单位", children: commissionBasisLabel[rule.basis] },
          { key: "fee", label: "团抽金额", children: fee(rule.clubFeeCents, rule.basis) },
        ]} /> : <Empty description="尚未配置抽成规则" />}
      {saved ? <Alert type="success" showIcon title="新规则已启用" /> : null}
    </Card>
    {club.permissions.includes("CLUB_ORDERS_READ") ? <DispatchHistory club={club} /> : null}
    <Modal title={editVersion === 0 ? "配置抽成规则" : "编辑抽成规则"} open={editVersion !== null} forceRender
      onCancel={() => setEditVersion(null)} onOk={() => form.submit()} confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}
      okText="确认启用" cancelText="取消" okButtonProps={{ disabled: (rule?.version ?? 0) !== editVersion || (rule?.basis === "gift_times" && rule.clubFeeCents === cents) }}>
      <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 16 }}>
        <Form.Item name="amount" label="每次团抽（元/次）" rules={[
          { required: true, message: "请填写团抽金额" },
          { validator: (_, value: string | null) => value == null || parseYuanAsCents(value) !== null ? Promise.resolve() : Promise.reject(new Error("请填写非负金额，最多两位小数")) },
        ]}>
          <InputNumber<string> stringMode step="0.01" changeOnBlur={false} inputMode="decimal" style={{ width: "100%" }} />
        </Form.Item>
        <Flex vertical gap="small">
          <Alert type="info" showIcon title="生效范围" description="首次派发时冻结每次抽成，原单及续段继续沿用首段抽成。" />
          {saveError ? <Alert type="error" showIcon title={saveError} role="alert" /> : null}
        </Flex>
      </Form>
    </Modal>
  </>;
}

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };

function DispatchHistory({ club }: { club: AdminClub }) {
  const [page, setPage] = useState<DispatchPricingRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { md } = Grid.useBreakpoint();
  const canReadFinance = club.permissions.includes("CLUB_FINANCE_READ");

  useEffect(() => {
    let active = true;
    setPending(true);
    setError("");
    getDispatchHistory(cursor).then(data => {
      if (!active) return;
      setPage(data.items);
      setNextCursor(data.nextCursor);
    }).catch(err => {
      if (active) setError(errorText(err, "规则快照加载失败"));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [cursor, attempt]);

  const columns: TableColumnsType<DispatchPricingRow> = [
    { title: "订单", dataIndex: "id", render: (id: string) => <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{id}</Typography.Text> },
    { title: "来源", dataIndex: "source", responsive: ["md"], render: (source: DispatchPricingRow["source"]) => sources[source] },
    { title: "派单人 ID", dataIndex: "dispatcherUserId", responsive: ["md"] },
    { title: "计抽口径", dataIndex: "basis", render: (basis: CommissionBasis) => <Tag color="blue">{commissionBasisLabel[basis]}</Tag> },
    { title: "版本", dataIndex: "version", responsive: ["md"], render: (version: number) => `V${version}` },
    { title: "团抽", key: "clubFee", render: (_, row) => fee(row.clubFeeCents, row.basis) },
  ];

  return <section>
    <Typography.Title level={5}>已派发订单的规则快照</Typography.Title>
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : <Table rowKey="id" columns={columns} dataSource={page} loading={pending} pagination={false} locale={{ emptyText: "暂无已派发订单的规则快照" }}
        expandable={{
          rowExpandable: row => !md || (canReadFinance && row.dispatchFeeCents !== undefined),
          expandedRowRender: row => <Descriptions size="small" column={1} items={[
            { key: "source", label: "订单来源", children: sources[row.source] },
            { key: "dispatcher", label: "派单人 ID", children: row.dispatcherUserId },
            { key: "version", label: "规则版本", children: `V${row.version}` },
            ...(!canReadFinance || row.dispatchFeeCents === undefined ? [] : [{ key: "dispatchFee", label: "派抽", children: fee(row.dispatchFeeCents, row.basis) }]),
            ...(canReadFinance ? row.segments ?? [] : []).map((segment, index) => ({
              key: `segment-${index}`, label: `${segment.period === "double" ? "双倍" : "普通"}期 · ${segment.hearts} 颗`,
              children: `¥${formatCentsAsYuan(segment.unitPriceCents)}/颗`,
            })),
            ...(canReadFinance ? row.giftSegments ?? [] : []).map((segment, index) => ({
              key: `gift-segment-${index}`,
              label: `${segment.period === "double" ? "双倍" : "普通"}期 · ${segment.paidGiftTimes} 次 · ${segment.dailyGiftTimes} 次/日`,
              children: fee(segment.unitPriceCents, "gift_times"),
            })),
          ]} />,
        }} />}
    {cursor || nextCursor ? <Flex gap="small" style={{ marginTop: 8 }}>
      <Button disabled={pending || !cursor} onClick={() => setCursor(undefined)}>返回首页</Button>
      <Button disabled={pending || !nextCursor} onClick={() => setCursor(nextCursor ?? undefined)}>下一页</Button>
    </Flex> : null}
  </section>;
}
