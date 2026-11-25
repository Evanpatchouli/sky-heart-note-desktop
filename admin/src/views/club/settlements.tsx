import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { Alert, Button, Drawer, Empty, Flex, Grid, Spin, Table, Typography } from "antd";
import { giftSettlementStatusLabel, type AdminGiftSettlement, type GiftSettlementRow } from "@webapp-template/common";
import { getSettlement, getSettlements } from "@/api/club.api";
import type { AdminClubContext } from "../home";
import GiftSettlementDetail from "./gift-settlement-detail";
import ClubBalanceCard from "./club-balance";

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "—";
function requestError(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "结算核算加载失败";
}

export default function Settlements() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const [params, setParams] = useSearchParams();
  const selected = club?.permissions.includes("CLUB_FINANCE_READ") ? club : null;
  const orderId = params.get("order") ?? undefined;
  const calculationId = params.get("calculation") ?? undefined;
  const { md } = Grid.useBreakpoint();

  function showOrder(order?: string, calculation?: string) {
    if (!selected) return;
    setParams({ ...(order ? { order } : {}), ...(calculation ? { calculation } : {}) }, { replace: true });
  }

  return <Flex vertical gap="middle">
    <Typography.Title level={4} style={{ margin: 0 }}>结算核对</Typography.Title>
    {loadFailed ? <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />
      : club === undefined ? <Spin aria-label="加载俱乐部" />
      : !selected ? <Empty description="当前账号未获财务查看权限" /> : <>
        <Typography.Text strong>{selected.name}</Typography.Text>
        <ClubBalanceCard />
        <SettlementList onOpen={showOrder} />
        <Drawer title="订单结算核算" open={!!orderId} onClose={() => showOrder()} size={md ? 760 : "100%"} destroyOnHidden>
          {orderId ? <SettlementDetail key={`${orderId}/${calculationId ?? ""}`}
            orderId={orderId} calculationId={calculationId} compact={!md}
            onChange={id => showOrder(orderId, id)} /> : null}
        </Drawer>
      </>}
  </Flex>;
}

function SettlementList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<(GiftSettlementRow)[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPending(true);
    setError("");
    getSettlements(cursor).then(result => {
      if (!active) return;
      setRows(result.items);
      setNext(result.nextCursor);
    }).catch(reason => {
      if (active) setError(requestError(reason));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [cursor, attempt]);

  return <Flex vertical gap="small">
    <Button style={{ alignSelf: "flex-end" }} onClick={() => setAttempt(value => value + 1)} loading={pending}>刷新列表</Button>
    {error ? <Alert type="error" showIcon title={error} /> :
      <Table<GiftSettlementRow> rowKey="orderId" size="small" dataSource={rows} loading={pending}
        pagination={false} locale={{ emptyText: "暂无已派发订单" }} columns={[
          { title: "订单", render: (_, row) => <Flex vertical>
            <Typography.Text strong>{sources[row.source]} · {row.agreedGiftTimes} 次</Typography.Text>
            <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{row.orderId}</Typography.Text>
          </Flex> },
          { title: "派发时间", responsive: ["md"], render: (_, row) => date(row.publishedAt) },
          { title: "结算状态", render: (_, row) => giftSettlementStatusLabel[row.status] },
          { title: "操作", width: 80, render: (_, row) => <Button size="small" onClick={() => onOpen(row.orderId)}>核对</Button> },
        ]} />}
    {cursor || next ? <Flex gap="small">
      <Button disabled={pending || !cursor} onClick={() => setCursor(undefined)}>返回首页</Button>
      <Button disabled={pending || !next} onClick={() => setCursor(next ?? undefined)}>下一页</Button>
    </Flex> : null}
  </Flex>;
}

function SettlementDetail({ orderId, calculationId, compact, onChange }: {
  orderId: string; calculationId?: string; compact: boolean; onChange: (id?: string) => void;
}) {
  const [data, setData] = useState<AdminGiftSettlement>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    getSettlement(orderId, calculationId).then(result => {
      if (!active) return;
      if (result) setData(result);
      else setError("没有返回结算数据");
    }).catch(reason => { if (active) setError(requestError(reason)); });
    return () => { active = false; };
  }, [orderId, calculationId, attempt]);
  const refresh = () => setAttempt(value => value + 1);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={refresh}>重试</Button>} />;
  if (!data) return <Spin aria-label="加载结算核算" />;
  return <GiftSettlementDetail data={data} history={!!calculationId}
    compact={compact} onChange={onChange} refresh={refresh} />;
}
