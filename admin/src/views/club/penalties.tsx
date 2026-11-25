import { useEffect, useState } from "react";
import { Alert, Button, Empty, Flex, Form, Input, Modal, Select, Spin, Table, Tag, Typography } from "antd";
import { clubAdjustmentStatusLabel, clubPenaltyPostingLabel, formatCentsAsYuan, parseYuanAsCents, type ClubAdjustmentRecord, type ClubPenaltyList } from "@sky-club/common";
import { useOutletContext } from "react-router";
import { getClubPenalties, publishClubPenalty } from "@/api/club-finance.api";
import type { AdminClubContext } from "../home";

type PenaltyFields = { memberUserId: string; orderId?: string; amount: string; reason: string };

const showDate = (date?: string) => date ? new Date(date).toLocaleString("zh-CN") : "—";
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试";

export default function ClubPenalties() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const allowed = club?.canDecideAdjustments || club?.permissions.includes("CLUB_FINANCE_READ");
  return <Flex vertical gap="middle">
    <Typography.Title level={4} style={{ margin: 0 }}>罚款管理</Typography.Title>
    {loadFailed ? <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />
      : club === undefined ? <Spin aria-label="加载俱乐部" />
      : allowed ? <PenaltyList /> : <Empty description="需要团长、副团长或财务核对权限" />}
  </Flex>;
}

function PenaltyList() {
  const [data, setData] = useState<ClubPenaltyList>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [requestId, setRequestId] = useState<string>();
  const [success, setSuccess] = useState("");
  const refresh = () => setAttempt(value => value + 1);

  useEffect(() => {
    let active = true;
    setError("");
    getClubPenalties().then(value => { if (active) setData(value); })
      .catch(reason => { if (active) setError(errorText(reason)); });
    return () => { active = false; };
  }, [attempt]);

  function name(userId?: string) {
    if (!userId) return "—";
    const nickname = data?.memberNames[userId];
    return nickname ? `${nickname} · ${userId}` : userId;
  }

  return <>
    <Flex gap="small" wrap="wrap" justify="flex-end">
      <Button onClick={refresh}>刷新列表</Button>
      {data?.canPublish ? <Button type="primary" onClick={() => {
        setSuccess("");
        setRequestId(crypto.randomUUID());
      }}>发布罚款</Button> : null}
    </Flex>
    {success ? <Alert type="success" showIcon title={success} /> : null}
    {error ? <Alert type="error" showIcon title={error} /> :
      <Table<ClubAdjustmentRecord> rowKey="id" size="small" dataSource={data?.records} loading={!data}
        scroll={{ x: 780 }} locale={{ emptyText: "暂无罚款记录" }} columns={[
          { title: "被罚款团员", width: 125, render: (_, row) => name(row.memberUserId) },
          { title: "金额", width: 100, render: (_, row) => `¥${formatCentsAsYuan(row.amountCents)}` },
          { title: "状态", width: 125, filters: Object.entries(clubAdjustmentStatusLabel).map(([value, text]) => ({ value, text })),
            onFilter: (value, row) => row.status === value, render: (_, { status, penaltyPosting }) => <Flex vertical align="start">
              <Tag color={status === "approved" ? "green" : status === "rejected" ? "default" : "orange"}>{clubAdjustmentStatusLabel[status]}</Tag>
              {penaltyPosting ? <Typography.Text type="secondary">{clubPenaltyPostingLabel[penaltyPosting]}</Typography.Text> : null}
            </Flex> },
          { title: "单据和原因", render: (_, row) => <Flex vertical>
            <Typography.Text>{row.reason}</Typography.Text>
            {row.orderId ? <Typography.Text type="secondary" copyable>{row.orderId}</Typography.Text> : null}
            {row.decisionReason ? <Typography.Text type="secondary">审核说明 {row.decisionReason}</Typography.Text> : null}
          </Flex> },
          { title: "提交", width: 170, render: (_, row) => <>{name(row.requestedByUserId)}<br />{showDate(row.createdAt)}</> },
          { title: "决定", width: 170, render: (_, row) => row.decidedByUserId ? <>{name(row.decidedByUserId)}<br />{showDate(row.decidedAt)}</> : "—" },
        ]} />}
    {data?.canPublish && requestId ? <PublishPenalty key={requestId} requestId={requestId} list={data}
      close={() => setRequestId(undefined)} onSaved={() => { setRequestId(undefined); setSuccess("罚款已生效"); refresh(); }} /> : null}
  </>;
}

function PublishPenalty({ requestId, list, close, onSaved }: {
  requestId: string; list: ClubPenaltyList; close: () => void; onSaved: () => void;
}) {
  const [form] = Form.useForm<PenaltyFields>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function publish(fields: PenaltyFields) {
    const amountCents = parseYuanAsCents(fields.amount);
    if (!amountCents || saving) return;
    const orderId = fields.orderId?.trim();
    setSaving(true);
    setError("");
    try {
      await publishClubPenalty({ requestId, memberUserId: fields.memberUserId, amountCents,
        reason: fields.reason.trim(), ...(orderId ? { orderId } : {}) });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return <Modal open title="发布罚款" okText="确认发布" cancelText="取消" onOk={form.submit}
    confirmLoading={saving} onCancel={() => { if (!saving) close(); }}>
    <Form form={form} layout="vertical" onFinish={publish} disabled={saving}>
      <Form.Item name="memberUserId" label="被罚款团员" rules={[{ required: true, message: "请选择被罚款团员" }]}>
        <Select showSearch={{ optionFilterProp: "label" }} options={list.candidates.map(({ userId, nickname }) => ({
          value: userId, label: nickname ? `${nickname} · ${userId}` : userId,
        }))} />
      </Form.Item>
      <Form.Item name="amount" label="罚款金额（元）" rules={[{ validator: (_, value) => parseYuanAsCents(value)
        ? Promise.resolve() : Promise.reject(new Error("请输入大于零且最多两位小数的金额")) }]}>
        <Input inputMode="decimal" />
      </Form.Item>
      <Form.Item name="reason" label="罚款原因" rules={[{ required: true, whitespace: true, message: "请填写罚款原因" }]}>
        <Input.TextArea maxLength={240} />
      </Form.Item>
      <Form.Item name="orderId" label="关联订单号（选填）" rules={[{ pattern: /^\s*(?:[\da-fA-F]{24})?\s*$/, message: "请输入有效的订单号" }]}>
        <Input />
      </Form.Item>
      <Typography.Text type="secondary">独立罚款发布后立即入账。关联未结单订单的罚款随结单扣记。</Typography.Text>
      {error ? <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} /> : null}
    </Form>
  </Modal>;
}
