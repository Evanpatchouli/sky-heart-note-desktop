import { useState } from "react";
import {
  Button, Descriptions, Drawer, Flex, Grid, Input, Progress, Select, Space,
  Table, Tag, Typography, type TableColumnsType,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { money, useClub } from "./club";

type Order = ReturnType<typeof useClub>["orders"][number];

const statusColors: Record<string, string> = {
  待派单: "gold", 已派发: "blue", 履约中: "processing", 待结算: "cyan",
  待提交改价: "orange", 待老板答复: "orange", 待登记补款: "gold",
  停送待退款: "volcano", 已退款: "default", 已撤回: "default",
};
function statusOf(order: Order) {
  const changes: Record<string, string> = {
    draft: "待提交改价", proposed: "待老板答复", agreed: "待登记补款",
    refundDue: "停送待退款", refunded: "已退款",
  };
  if (changes[order.change]) return changes[order.change];
  if (order.status === "withdrawn") return "已撤回";
  if (order.status === "pending") return "待派单";
  if (order.delivered >= order.total) return "待结算";
  return order.status === "active" || order.delivered > 0 ? "履约中" : "已派发";
}
function orderStatus(order: Order) {
  const label = statusOf(order);
  return <Tag color={statusColors[label]}>{label}</Tag>;
}
function progress(order: Order) {
  const fraction = order.total > 0 ? order.delivered / order.total : 0;
  return <div style={{ minWidth: 90 }}>
    <span>{order.delivered} / {order.total} 颗</span>
    <Progress percent={Math.round(fraction * 100)} showInfo={false} size="small" />
  </div>;
}
function orderName(order: Order) {
  return <div>
    <Typography.Text strong>{order.title}</Typography.Text><br />
    <Typography.Text type="secondary">{order.id}</Typography.Text>
  </div>;
}

function OrderDetail({ order, mobile }: { order: Order; mobile: boolean }) {
  const { rules } = useClub();
  const pending = order.status === "pending";
  const effective = pending ? rules : order;
  // 跨期示例的变更基数固定在提报时，续送后的剩余量不会改变历史款项。
  const affected = order.changeQty ?? 0;
  const surcharge = affected * (50 - order.unit);
  const refund = affected * order.unit;
  const refunded = order.change === "refunded" ? refund : 0;
  const supplementPaid = order.change === "paid" ? surcharge : 0;
  const refunding = order.change === "refundDue" || order.change === "refunded";
  const assigned = order.claims.reduce((total, item) => total + item.qty, 0);
  const unit = effective.basis === "赠送次数" ? "次" : "颗";
  const changing = order.change !== "none" && affected > 0;
  return <Flex vertical gap={24} data-testid="review-order-detail">
    <div>
      <Space wrap><Typography.Title level={4} style={{ margin: 0 }}>{order.title}</Typography.Title>{orderStatus(order)}</Space>
      <div><Typography.Text type="secondary">{order.id}</Typography.Text></div>
    </div>
    <Descriptions title="派发信息" bordered size="small" column={mobile ? 1 : 2} items={[
      { key: "source", label: "订单来源", children: order.source },
      { key: "customer", label: "老板", children: order.customer },
      { key: "dispatcher", label: "派单人", children: order.dispatcher },
      { key: "assignee", label: "派发对象", children: order.status === "pending" ? "待派发" : order.assignee || "公开抢单" },
    ]} />
    <div>
      <Typography.Title level={5}>承接与交付</Typography.Title>
      <Typography.Paragraph>已分配 {assigned} / {order.total} 颗，实际赠送 {order.times} 次，到账 {order.delivered} 颗。</Typography.Paragraph>
      <Table rowKey="name" size="small" pagination={false} locale={{ emptyText: "暂无承接记录" }}
        dataSource={order.claims} columns={[
          { title: "送心员", dataIndex: "name" },
          { title: "承接份额", dataIndex: "qty", align: "right", render: amount => amount + " 颗" },
          { title: "本人到账", dataIndex: "delivered", align: "right", render: amount => (amount ?? 0) + " 颗" },
        ]} />
    </div>
    <Descriptions title={order.status === "pending" ? "待派发报价" : "派发时规则"} bordered size="small" column={mobile ? 1 : 2} items={[
      { key: "price", label: "爱心单价", children: money(order.unit) + " / 到账颗" },
      { key: "period", label: "原报价时段", children: order.period === "double" ? "双倍期" : "普通期" },
      { key: "basis", label: "统一抽成口径", children: effective.basis },
      { key: "version", label: "规则版本", children: pending ? `V${rules.version}（派发时锁定）` : `V${order.ruleVersion}` },
      { key: "dispatch", label: "派抽", children: money(order.dispatchFee) + " / " + unit },
      { key: "club", label: "团抽", children: money(effective.clubFee) + " / " + unit },
    ]} />
    <Descriptions title="收退款核对" bordered size="small" column={mobile ? 1 : 2} items={[
      { key: "quote", label: pending ? "预计爱心款" : "原订单价", children: money(order.total * order.unit) },
      { key: "paid", label: "原单实收", children: money(order.paid - supplementPaid) },
      ...(changing ? [
        { key: "affected", label: "变更涉及", children: affected + " 颗" },
        { key: "change", label: refunding ? "应退金额" : "变更差额", children: money(refunding ? refund : surcharge) },
        { key: "why", label: "变更原因", children: order.reason || "待派单人填写", span: mobile ? 1 : 2 },
      ] : []),
      { key: "extra", label: "实补", children: money(supplementPaid) },
      { key: "refund", label: "实退", children: money(refunded) },
      { key: "net", label: "净实收", children: <Typography.Text strong>{money(order.paid - refunded)}</Typography.Text>, span: mobile ? 1 : 2 },
    ]} />
  </Flex>;
}

export default function Orders() {
  const { orders } = useClub();
  const mobile = !Grid.useBreakpoint().md;
  const [source, setSource] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = orders.find(order => order.id === selectedId);
  const keyword = search.trim().toLowerCase();
  const filtered = orders.filter(order =>
    (!source || order.source === source) && (!status || statusOf(order) === status) &&
    [order.id, order.title, order.customer, order.dispatcher].some(value => value.toLowerCase().includes(keyword)));
  const actionColumn: TableColumnsType<Order>[number] = {
    title: "操作", width: 84,
    render: (_, order) => <Button onClick={() => setSelectedId(order.id)} aria-label={`查看 ${order.id} 详情`}>详情</Button>,
  };
  const columns: TableColumnsType<Order> = mobile ? [
    { title: "订单", render: (_, order) => <Space orientation="vertical" size={4}>
      {orderName(order)}<Space wrap size={4}>{orderStatus(order)}<span>{order.source}</span></Space>
      <Typography.Text type="secondary">{order.customer} · 到账 {order.delivered}/{order.total} 颗</Typography.Text>
    </Space> }, actionColumn,
  ] : [
    { title: "订单", width: 212, render: (_, order) => orderName(order) },
    { title: "来源", width: 110, dataIndex: "source" },
    { title: "老板", width: 80, dataIndex: "customer" },
    { title: "派单人", width: 86, dataIndex: "dispatcher" },
    { title: "状态", width: 108, render: (_, order) => orderStatus(order) },
    { title: "到账进度", width: 148, render: (_, order) => progress(order) },
    { title: "累计实收", width: 112, align: "right", dataIndex: "paid", render: money },
    actionColumn,
  ];
  return <section className="review-page">
    <Typography.Title level={4}>订单监管</Typography.Title>
    <Flex className="review-toolbar" wrap gap={8} style={{ marginBottom: 16 }}>
      <Input allowClear prefix={<SearchOutlined />} placeholder="订单号、订单名称或成员" aria-label="搜索订单"
        style={{ width: mobile ? "100%" : 240 }} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <Select allowClear aria-label="订单来源" placeholder="订单来源" style={{ minWidth: 112 }} value={source}
        onChange={value => { setSource(value); setPage(1); }}
        options={["直接派单", "客户端下单"].map(value => ({ value, label: value }))} />
      <Select allowClear aria-label="订单状态" placeholder="订单状态" style={{ minWidth: 120 }} value={status}
        onChange={value => { setStatus(value); setPage(1); }}
        options={Object.keys(statusColors).map(value => ({ value, label: value }))} />
      <Button onClick={() => { setSearch(""); setSource(undefined); setStatus(undefined); setPage(1); }}>重置</Button>
    </Flex>
    <Table<Order> rowKey="id" columns={columns} dataSource={filtered} scroll={mobile ? undefined : { x: 940 }}
      locale={{ emptyText: "暂无符合条件的订单" }} pagination={{
        current: Math.min(page, Math.max(1, Math.ceil(filtered.length / 8))), pageSize: 8,
        showSizeChanger: false, onChange: setPage, showTotal: total => `共 ${total} 笔`,
      }} />
    <Drawer title="订单详情" open={!!selected} onClose={() => setSelectedId(undefined)}
      size={mobile ? "100%" : 620} destroyOnHidden>
      {selected && <OrderDetail order={selected} mobile={mobile} />}
    </Drawer>
  </section>;
}
