import { useState, useSyncExternalStore } from "react";
import {
  App, Button, Card, Col, Descriptions, Divider, Drawer, Flex, Grid, Row,
  Space, Statistic, Table, Tabs, Tag, Typography, type TableColumnsType,
} from "antd";
import { money } from "./club";

type Worker = { name: string; delivered: number; unlocks: number };
type Settlement = {
  id: string; title: string; paidHearts: number; giftHearts: number;
  unit: number; dispatcher: string; dispatchFee: number; clubFee: number;
  unlockFee: number; workers: Worker[];
};
type Entry = { id: string; category: string; account: string; amount: number; note: string };
const cases: Settlement[] = [
  { id: "JZ-1124-01", title: "普通送心 · 100 颗", paidHearts: 100, giftHearts: 0,
    unit: 50, dispatcher: "青禾", dispatchFee: 5, clubFee: 5, unlockFee: 10,
    workers: [{ name: "云岫", delivered: 50, unlocks: 5 }, { name: "阿澄", delivered: 50, unlocks: 5 }] },
  { id: "JZ-1124-02", title: "买 100 送 5", paidHearts: 100, giftHearts: 5,
    unit: 50, dispatcher: "鹿鸣", dispatchFee: 5, clubFee: 5, unlockFee: 10,
    workers: [{ name: "禾川", delivered: 105, unlocks: 0 }] },
];

function reconcile(s: Settlement) {
  const delivered = s.workers.reduce((sum, w) => sum + w.delivered, 0);
  const unlocks = s.workers.reduce((sum, w) => sum + w.unlocks, 0);
  const receipt = s.paidHearts * s.unit + unlocks * s.unlockFee;
  const unitNet = s.unit - s.dispatchFee - s.clubFee;
  const entries: Entry[] = [
    { id: s.id + "-D", category: "派单收益", account: s.dispatcher, amount: delivered * s.dispatchFee,
      note: `${delivered} 颗 × ${money(s.dispatchFee)}` },
    { id: s.id + "-C", category: "团抽收入", account: "团费", amount: delivered * s.clubFee,
      note: `${delivered} 颗 × ${money(s.clubFee)}` },
    ...s.workers.map((worker, index) => ({
      id: s.id + "-W" + (index + 1), category: "送心收益", account: worker.name,
      amount: worker.delivered * unitNet + worker.unlocks * s.unlockFee,
      note: `${worker.delivered} 颗 × ${money(unitNet)}` + (worker.unlocks ? ` + 解锁 ${worker.unlocks} 次 × ${money(s.unlockFee)}` : ""),
    })),
  ];
  if (s.giftHearts) entries.push({
    id: s.id + "-G", category: "赠心支出", account: "团费", amount: -s.giftHearts * s.unit,
    note: `赠送 ${s.giftHearts} 颗 × ${money(s.unit)}，从团费扣除`,
  });
  const allocated = entries.reduce((sum, e) => sum + e.amount, 0);
  const clubNet = delivered * s.clubFee - s.giftHearts * s.unit;
  return { delivered, unlocks, receipt, entries, allocated, clubNet, difference: receipt - allocated };
}

// 每个结算单仅占用一个凭据键。页面与流水均从同一凭据推导，重复操作不追加金额。
const key = (id: string) => "sky-heart.admin-review.finance.v1." + id;
const memory = new Map<string, string>();
const updated = "sky-heart-finance-posted";
function postedAt(id: string) {
  try { return localStorage.getItem(key(id)) ?? memory.get(id) ?? null; } catch { return memory.get(id) ?? null; }
}
function savePosting(id: string) {
  if (postedAt(id)) return;
  const timestamp = new Date().toISOString();
  try { localStorage.setItem(key(id), timestamp); } catch { memory.set(id, timestamp); }
  window.dispatchEvent(new Event(updated));
}
function resetPostings() {
  for (const s of cases) {
    try { localStorage.removeItem(key(s.id)); } catch { /* 使用本页内存。 */ }
    memory.delete(s.id);
  }
  window.dispatchEvent(new Event(updated));
}
function subscribe(notify: () => void) {
  window.addEventListener(updated, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(updated, notify);
    window.removeEventListener("storage", notify);
  };
}
const snapshot = () => cases.map(s => postedAt(s.id) || "").join("|");
const signed = (amount: number) => (amount < 0 ? "−" : "+") + money(Math.abs(amount));

function SettlementDetail({ data, compact }: { data: Settlement; compact: boolean }) {
  const summary = reconcile(data);
  return <Flex vertical gap={20} data-testid="review-settlement-detail">
    <Space wrap><Typography.Title level={4} style={{ margin: 0 }}>{data.title}</Typography.Title>
      <Tag color={postedAt(data.id) ? "green" : "gold"}>{postedAt(data.id) ? "已入账" : "待入账"}</Tag></Space>
    <Descriptions size="small" bordered column={compact ? 1 : 2} items={[
      { key: "id", label: "结算单号", children: data.id },
      { key: "basis", label: "统一抽成口径", children: "到账颗数" },
      { key: "price", label: "每颗单价", children: money(data.unit) },
      { key: "qty", label: "付费 / 赠送", children: `${data.paidHearts} / ${data.giftHearts} 颗` },
      { key: "done", label: "实际到账", children: summary.delivered + " 颗" },
      { key: "unlock", label: "实际解锁", children: summary.unlocks + " 次" },
      { key: "fees", label: "派抽 / 团抽", children: `${money(data.dispatchFee)} / ${money(data.clubFee)}（元/颗）`, span: compact ? 1 : 2 },
      { key: "receipt", label: "收款依据", children: `爱心款 ${money(data.paidHearts * data.unit)} + 解锁款 ${money(summary.unlocks * data.unlockFee)}`, span: compact ? 1 : 2 },
    ]} />
    <div><Typography.Title level={5}>分账明细</Typography.Title>
      <Table<Entry> rowKey="id" size="small" pagination={false} dataSource={summary.entries}
        columns={[
          { title: "账户 / 科目", render: (_, e) => <Space orientation="vertical" size={0}><span>{e.account} · {e.category}</span>
            <Typography.Text type="secondary">{e.note}</Typography.Text></Space> },
          { title: "金额", width: 98, align: "right", dataIndex: "amount", render: signed },
        ]} />
    </div>
    <Descriptions bordered size="small" column={compact ? 1 : 2} items={[
      { key: "received", label: "订单实收", children: money(summary.receipt) },
      { key: "allocated", label: "分配合计", children: money(summary.allocated) },
      { key: "club", label: "团费净变动", children: signed(summary.clubNet) },
      { key: "difference", label: "对账差额", children: <Tag color={summary.difference === 0 ? "success" : "error"}>{money(summary.difference)}</Tag> },
    ]} />
  </Flex>;
}

export default function Finance() {
  const { modal, message } = App.useApp();
  const compact = !Grid.useBreakpoint().md;
  useSyncExternalStore(subscribe, snapshot);
  const [selected, setSelected] = useState<Settlement>();
  const [tab, setTab] = useState("settlements");
  const posted = cases.filter(s => postedAt(s.id));
  const pending = cases.filter(s => !postedAt(s.id));
  const sumReceipts = (rows: Settlement[]) => rows.reduce((sum, s) => sum + reconcile(s).receipt, 0);
  const book = (s: Settlement) => {
    const calculation = reconcile(s);
    if (postedAt(s.id) || calculation.difference) return;
    modal.confirm({
      title: "确认结算入账？",
      content: `${s.id} 的订单实收与分配合计均为 ${money(calculation.receipt)}。确认后将生成 ${calculation.entries.length} 条演示流水。`,
      okText: "确认入账", cancelText: "取消",
      onOk: () => { savePosting(s.id); message.success("已登记结算流水"); },
    });
  };

  const ledger = posted.flatMap(s => reconcile(s).entries.map(entry => ({ ...entry, settlement: s.id })));
  const columns: TableColumnsType<Settlement> = [
    { title: "结算单", render: (_, s) => <Space orientation="vertical" size={0}>
      <Typography.Text strong>{s.title}</Typography.Text><Typography.Text type="secondary">{s.id}</Typography.Text>
      {compact && <span>实收 {money(reconcile(s).receipt)}</span>}
    </Space> },
    ...(!compact ? [
      { title: "到账爱心", render: (_: unknown, s: Settlement) => reconcile(s).delivered + " 颗" },
      { title: "订单实收", align: "right" as const, render: (_: unknown, s: Settlement) => money(reconcile(s).receipt) },
      { title: "团费净变动", align: "right" as const, render: (_: unknown, s: Settlement) => signed(reconcile(s).clubNet) },
    ] : []),
    { title: "状态", width: 90, render: (_, s) => postedAt(s.id) ? <Tag color="green">已入账</Tag> : <Tag color="gold">待入账</Tag> },
    { title: "操作", width: compact ? 72 : 98, render: (_, s) => <Button onClick={() => setSelected(s)}>核对</Button> },
  ];
  return <section className="review-page">
    <Flex align="center" justify="space-between" wrap gap={8} style={{ marginBottom: 16 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>财务对账</Typography.Title>
      <Button disabled={!posted.length} onClick={() => modal.confirm({
        title: "重置财务演示记录？", content: "两笔对账样单将恢复为待入账状态。",
        okText: "重置样例", cancelText: "取消", onOk: resetPostings,
      })}>重置财务样例</Button>
    </Flex>
    <Row gutter={[12, 12]}>
      {[
        ["样单实收", sumReceipts(cases)],
        ["待入账金额", sumReceipts(pending)],
        ["已入账团费净额", posted.reduce((sum, s) => sum + reconcile(s).clubNet, 0)],
      ].map(([title, amount]) => <Col key={String(title)} xs={24} sm={8}>
        <Card size="small"><Statistic title={title} value={Number(amount) / 100} prefix="¥" precision={2} /></Card>
      </Col>)}
    </Row>
    <Tabs style={{ marginTop: 16 }} activeKey={tab} onChange={setTab} items={[
      { key: "settlements", label: "结算样单", children:
        <Table rowKey="id" columns={columns} dataSource={cases} scroll={compact ? undefined : { x: 660 }} pagination={false} /> },
      { key: "ledger", label: "入账流水", children: <Table rowKey="id" dataSource={ledger}
        scroll={compact ? undefined : { x: 660 }} pagination={false}
        locale={{ emptyText: "暂无入账流水，核对结算样单后可确认入账" }} columns={[
          { title: compact ? "流水 / 科目" : "流水编号", render: (_, e) => <Space orientation="vertical" size={0}>
            <span>{e.id}</span>{compact && <Typography.Text type="secondary">{e.account} · {e.category}</Typography.Text>}</Space> },
          ...(!compact ? [{ title: "科目", dataIndex: "category" }, { title: "账户", dataIndex: "account" }, { title: "依据", dataIndex: "note" }] : []),
          { title: "发生额", align: "right", width: 98, dataIndex: "amount", render: signed },
        ]} /> },
    ]} />
    <Drawer title="结算核对" open={!!selected} onClose={() => setSelected(undefined)} size={compact ? "100%" : 620}
      destroyOnHidden footer={selected && <Flex justify="end" gap={8}>
        <Button onClick={() => setSelected(undefined)}>关闭</Button>
        <Button type="primary" disabled={!!postedAt(selected.id) || reconcile(selected).difference !== 0}
          onClick={() => book(selected)}>{postedAt(selected.id) ? "已入账" : "确认入账"}</Button>
      </Flex>}>
      {selected && <><SettlementDetail data={selected} compact={compact} />{postedAt(selected.id) && <>
        <Divider /><Typography.Text type="secondary">演示入账时间 {new Date(postedAt(selected.id)!).toLocaleString("zh-CN")}</Typography.Text>
      </>}</>}
    </Drawer>
  </section>;
}
