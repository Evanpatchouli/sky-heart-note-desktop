import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import { Alert, Button, Card, Drawer, Empty, Flex, Grid, Select, Spin, Typography } from "antd";
import type { DashboardMetric, DashboardOrderList, DashboardOrderRow, DashboardSource } from "@sky-club/common";
import { getDashboardOrder, getDashboardOrders } from "@/api/club-dashboard.api";
import type { AdminClubContext } from "../home";
import { dispatchStatusLabel, metricLabels, received, sourceLabels } from "./dashboard-shared";
import OrderFacts from "./order-facts";
import { ServiceOrders } from "@sky-club/common/service-orders";
import { useLoginStore } from "@/auth/store";

export default function Orders() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const [params, setParams] = useSearchParams();
  const token = useLoginStore(state => state.token) ?? "";
  const userId = useLoginStore(state => state.userInfo?.id) ?? "";
  if (loadFailed) return <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />;
  if (club === undefined) return <Spin aria-label="加载俱乐部" />;
  const canReadOrders = !!club?.permissions.includes("CLUB_ORDERS_READ");
  const canReadFinance = !!club?.permissions.includes("CLUB_FINANCE_READ");
  if (!canReadOrders && !canReadFinance) return <Empty description="当前账号没有订单或财务查看权限" />;
  const business = params.get("business") === "companionship" ? "companionship" : params.get("business") === "daily_run" ? "daily_run" : undefined;
  function switchBusiness(value?: "daily_run" | "companionship") {
    const next = new URLSearchParams(params); if (value) next.set("business", value); else next.delete("business"); next.delete("serviceOrder"); setParams(next);
  }
  return <><nav aria-label="业务类型" className="service-business-switch"><button aria-current={!business ? "page" : undefined} onClick={() => switchBusiness()}>送心</button>{canReadOrders ? <><button aria-current={business === "daily_run" ? "page" : undefined} onClick={() => switchBusiness("daily_run")}>代跑</button><button aria-current={business === "companionship" ? "page" : undefined} onClick={() => switchBusiness("companionship")}>陪玩</button></> : null}</nav>
    {business && !canReadOrders ? <Empty description="当前账号没有服务订单查看权限" /> : business ? <ServiceOrders key={`${userId}:${business}`} app="admin" userId={userId} token={token} business={business} orderId={params.get("serviceOrder")} onOpen={id => {
      const next = new URLSearchParams(params); if (id) next.set("serviceOrder", id); else next.delete("serviceOrder"); setParams(next);
    }} /> : <OrderList key={`${canReadOrders}/${canReadFinance}`} canReadOrders={canReadOrders} canReadFinance={canReadFinance} />}</>;
}

function OrderList({ canReadOrders, canReadFinance }: { canReadOrders: boolean; canReadFinance: boolean }) {
  const [params, setParams] = useSearchParams();
  const metricValue = params.get("metric") ?? "all";
  const metric = !canReadOrders ? "ready_to_close" : Object.hasOwn(metricLabels, metricValue) && (metricValue !== "ready_to_close" || canReadFinance) ? metricValue as DashboardMetric : "all";
  const sourceValue = params.get("source") ?? "";
  const source = Object.hasOwn(sourceLabels, sourceValue) ? sourceValue as DashboardSource : undefined;
  const after = params.get("after") || undefined;
  const order = canReadOrders ? params.get("order") || undefined : undefined;
  const [result, setResult] = useState<{ key: string; data?: DashboardOrderList; error?: string }>();
  const [revision, setRevision] = useState(0);
  const { md } = Grid.useBreakpoint();
  const queryKey = `${metric}/${source ?? ""}/${after ?? ""}/${revision}`;
  const data = result?.key === queryKey ? result.data : undefined;
  const error = result?.key === queryKey ? result.error : undefined;
  useEffect(() => {
    let active = true;
    getDashboardOrders(metric, source, after).then(value => { if (active) setResult({ key: queryKey, data: value }); })
      .catch(reason => { if (active) setResult({ key: queryKey, error: reason?.message || "订单加载失败" }); });
    return () => { active = false; };
  }, [metric, source, after, queryKey]);
  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next);
  }
  return <Flex vertical gap="middle">
    <Flex justify="space-between" align="center" wrap gap="small"><Typography.Title level={4} style={{ margin: 0 }}>订单监管</Typography.Title><Flex gap="small"><Link to="/dashboard">返回仪表盘</Link><Button onClick={() => setRevision(value => value + 1)}>刷新清单</Button></Flex></Flex>
    <Flex wrap gap="small">
      <Select aria-label="订单口径" value={metric} disabled={!canReadOrders} style={{ minWidth: 180 }} options={Object.entries(metricLabels).filter(([value]) => value !== "ready_to_close" || canReadFinance).map(([value, label]) => ({ value, label }))}
        onChange={value => update({ metric: value === "all" ? undefined : value, after: undefined, order: undefined })} />
      <Select aria-label="订单来源" value={source ?? "all"} style={{ minWidth: 150 }} options={[{ value: "all", label: "全部来源" }, ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))]}
        onChange={value => update({ source: value === "all" ? undefined : value, after: undefined, order: undefined })} />
    </Flex>
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} /> : !data ? <Spin aria-label="加载订单清单" /> : <>
      {data.items.length ? data.items.map(row => <Card size="small" key={row.orderId}>
        <Flex justify="space-between" align="center" wrap gap="small">
          <Flex vertical><Typography.Text strong>{sourceLabels[row.source]} · {row.recipientGameAccount}</Typography.Text>
            <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{row.orderId} · {dispatchStatusLabel(row.dispatchStatus)}{row.actionLabel ? ` · ${row.actionLabel}` : ""}</Typography.Text>
            <Typography.Text type="secondary">{row.priceUnit === "hearts" ? "历史按颗订单" : `已履约 ${row.deliveredGiftTimes === null ? "待确认" : `${row.deliveredGiftTimes} 次`} · 可承接 ${row.claimableGiftTimes} 次`} · 到账 {received(row.knownReceivedHearts, row.unknownReceivedLines, row.knownReceivedLines)}</Typography.Text>
          </Flex>{metric === "ready_to_close" ? <Link to={`/club/settlements?order=${encodeURIComponent(row.orderId)}`}>财务核对</Link>
            : <Button onClick={() => update({ order: row.orderId })} aria-label={`查看订单 ${row.orderId}`}>详情</Button>}
        </Flex>
      </Card>) : <Empty description="此口径暂无订单" />}
      {after || data.nextCursor ? <Flex gap="small"><Button disabled={!after} onClick={() => update({ after: undefined })}>返回首页</Button><Button disabled={!data.nextCursor} onClick={() => update({ after: data.nextCursor ?? undefined })}>下一页</Button></Flex> : null}
    </>}
    <Drawer title="订单详情" open={!!order} onClose={() => update({ order: undefined })} size={md ? 680 : "100%"} destroyOnHidden>
      {order ? <OrderDetail key={order} id={order} canReadFinance={canReadFinance} /> : null}
    </Drawer>
  </Flex>;
}

function OrderDetail({ id, canReadFinance }: { id: string; canReadFinance: boolean }) {
  const [row, setRow] = useState<DashboardOrderRow>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    getDashboardOrder(id).then(value => { if (active) { setRow(value); setError(""); } })
      .catch(reason => { if (active) setError(reason?.message || "订单详情加载失败"); });
    return () => { active = false; };
  }, [id, revision]);
  return <Flex vertical gap="middle">
    <Button style={{ alignSelf: "flex-start" }} onClick={() => setRevision(value => value + 1)}>刷新详情</Button>
    {error ? <Alert type="error" showIcon title={error} /> : !row ? <Spin aria-label="加载订单详情" /> : <>
      <OrderFacts row={row} />
      {canReadFinance && row.dispatchStatus === "published" ? <Link to={`/club/settlements?order=${encodeURIComponent(row.orderId)}`}>前往财务核对</Link> : null}
    </>}
  </Flex>;
}
