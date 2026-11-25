import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router";
import { Alert, Button, Card, Col, Empty, Flex, Row, Spin, Statistic, Typography } from "antd";
import { formatCentsAsYuan, type ClubDashboard, type DashboardMetric } from "@sky-club/common";
import { getDashboard } from "@/api/club-dashboard.api";
import { useLoginStore } from "@/auth/store";
import type { AdminClubContext } from "../home";
import { dispatchStatusLabel, orderUrl, received, sourceLabels } from "../club/dashboard-shared";

const money = (cents: number) => `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;

export default function Dashboard() {
  const token = useLoginStore(state => state.token);
  return <DashboardContent key={token} />;
}

function DashboardContent() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const [data, setData] = useState<ClubDashboard>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const canReadOrders = !!club?.permissions.includes("CLUB_ORDERS_READ");
  const canReadFinance = !!club?.permissions.includes("CLUB_FINANCE_READ");
  const canRead = canReadOrders || canReadFinance;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRevision(value => value + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    let timer: number;
    async function poll() {
      try {
        if (document.visibilityState === "visible") {
          const value = await getDashboard();
          if (active) { setData(value); setError(""); }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "仪表盘加载失败");
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 15000);
      }
    }
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [canRead, canReadOrders, canReadFinance, revision]);

  if (loadFailed) return <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />;
  if (club === undefined) return <Spin aria-label="加载俱乐部" />;
  if (!canRead) return <Empty description="当前账号没有订单或财务查看权限" />;
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />;
  if (!data) return <Spin aria-label="加载运营仪表盘" />;

  const operations = canReadOrders ? data.operations : undefined;
  const finance = canReadFinance ? data.finance : undefined;
  const metrics: { metric: DashboardMetric; title: string; value: number | string; unit: string; hint?: string }[] = operations ? [
    { metric: "pending_dispatch", title: "待派单订单", value: operations.pendingOrders, unit: "笔" },
    { metric: "claimable", title: "可承接", value: operations.claimableGiftTimes, unit: "次" },
    { metric: "fulfilled", title: "已履约", value: operations.deliveredGiftTimes, unit: "次" },
    { metric: "received", title: "已知实际到账", value: operations.knownReceivedLines ? operations.knownReceivedHearts : operations.unknownReceivedLines ? "待确认" : "暂无记录", unit: operations.knownReceivedLines ? "颗" : "", hint: operations.unknownReceivedLines ? `${operations.unknownReceivedLines} 条到账待确认` : undefined },
    { metric: "action_required", title: "改价与退款待办", value: operations.actionOrders, unit: "笔" },
  ] : [];
  return <Flex vertical gap="middle">
    <Flex justify="space-between" align="center" wrap gap="small">
      <div><Typography.Title level={4} style={{ margin: 0 }}>俱乐部运营仪表盘</Typography.Title><Typography.Text type="secondary">{club?.name} · 全部订单</Typography.Text></div>
      <Button onClick={() => setRevision(value => value + 1)}>刷新仪表盘</Button>
    </Flex>
    {operations ? <>
      <Row gutter={[12, 12]}>{metrics.map(metric => <Col key={metric.metric} xs={12} md={8} xl={4}>
        <Link to={orderUrl({ metric: metric.metric })} aria-label={`${metric.title} ${metric.value} ${metric.unit}，查看订单`}>
          <Card size="small" hoverable style={{ height: "100%" }}><Statistic title={metric.title} value={metric.value} suffix={metric.unit} />{metric.hint ? <Typography.Text type="secondary">{metric.hint}</Typography.Text> : null}</Card>
        </Link>
      </Col>)}</Row>
      <Card size="small" title="派单与履约待办" extra={<Link to={orderUrl()}>订单监管</Link>}>
        {operations.attention.length ? <Flex vertical gap="small">{operations.attention.map(row => <Flex key={row.orderId} justify="space-between" align="center" gap="small" wrap>
          <div><Typography.Text strong>{sourceLabels[row.source]} · {row.recipientGameAccount}</Typography.Text><div><Typography.Text type="secondary">{row.actionLabel ?? (row.pendingDispatch ? "待派单" : dispatchStatusLabel(row.dispatchStatus))} · {row.orderId}</Typography.Text></div></div>
          <Link to={orderUrl({ metric: row.actionLabel ? "action_required" : row.pendingDispatch ? "pending_dispatch" : "all", order: row.orderId })} aria-label={`查看待办 ${row.orderId}`}>查看详情</Link>
        </Flex>)}</Flex> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理订单" />}
      </Card>
      <Card size="small" title="订单来源与交付">
        <Row gutter={[16, 16]}>{operations.sources.map(source => <Col key={source.source} xs={24} md={12}>
          <Flex vertical gap="small"><Typography.Text strong>{sourceLabels[source.source]} · {source.orders} 笔</Typography.Text>
            <Link to={orderUrl({ source: source.source, metric: "all" })}>查看全部订单</Link>
            <Link to={orderUrl({ source: source.source, metric: "fulfilled" })}>已履约 {source.deliveredGiftTimes} 次</Link>
            <Link to={orderUrl({ source: source.source, metric: "received" })}>实际到账 {received(source.knownReceivedHearts, source.unknownReceivedLines, source.knownReceivedLines)}</Link>
          </Flex>
        </Col>)}</Row>
      </Card>
    </> : null}
    {finance ? <Card size="small" title="结算核对" extra={<Link to="/club/settlements">财务核对</Link>}>
      <Flex vertical gap="small"><Link to={orderUrl({ metric: "ready_to_close" })}>待结单 {finance.readyOrders} 笔 · 净实收 {money(finance.readyNetCents)}</Link>
        <Link to="/club/settlements">团费已入账余额 {money(finance.clubBalanceCents)}</Link>
        {finance.ready.length ? finance.ready.map(row => <Link key={row.orderId} to={`/club/settlements?order=${encodeURIComponent(row.orderId)}`}>核对订单 {row.orderId} · {money(row.netReceivedCents)}</Link>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待结单订单" />}
      </Flex>
    </Card> : null}
  </Flex>;
}
