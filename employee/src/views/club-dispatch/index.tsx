import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Select, Spin, Typography } from "antd";
import { Link, useSearchParams } from "react-router";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import NewDirectDraft from "./new-direct-draft";
import CustomerActivation from "./customer-activation";

type Club = { id: string; name: string };
type Order = {
  id: string;
  source: "direct_dispatch" | "client_order";
  customerUserId?: string | null;
  customerLinkStatus?: "verified" | "pending_verification";
  customerActivationAvailable?: boolean;
  recipientGameAccount: string;
  requestedHearts: number;
};
type Page = { items: Order[]; nextCursor: string | null };

export default function ClubDispatch() {
  const [params, setParams] = useSearchParams();
  const [clubs, setClubs] = useState<Club[]>();
  const [error, setError] = useState("");
  const club = clubs?.find(({ id }) => id === params.get("clubId")) ?? clubs?.[0];

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<Club[]>("clubs", "GET", undefined, controller.signal).then(setClubs).catch(err => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, []);

  return <>
    <Header />
    <main style={{ flex: 1, overflow: "auto", width: "100%", padding: 16, boxSizing: "border-box" }}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Link to="/">返回个人订单</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>派单准备</Typography.Title>
        {error ? <Alert type="error" showIcon title={error} /> : club ? <>
          <label>俱乐部 <Select aria-label="俱乐部" value={club.id} onChange={clubId => setParams({ clubId })}
            options={clubs?.map(({ id, name }) => ({ value: id, label: name }))} /></label>
          <ClubOrders key={club.id} clubId={club.id} />
        </> : clubs ? <Empty description="暂无可访问的俱乐部" /> : <Spin aria-label="加载俱乐部" />}
      </Flex>
    </main>
  </>;
}

function ClubOrders({ clubId }: { clubId: string }) {
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState<Page>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = after ? `?${new URLSearchParams({ after })}` : "";
    employeeRequest<Page>(`clubs/${clubId}/orders${query}`, "GET", undefined, controller.signal).then(setPage).catch(err => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [clubId, after, revision]);

  function goTo(cursor?: string) {
    setPage(undefined);
    setError("");
    setAfter(cursor);
  }

  return <>
    <Card size="small" title="俱乐部订单" extra={<Button onClick={() => setCreating(true)}>新建直接派单草稿</Button>}>
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => {
        setError("");
        setRevision(value => value + 1);
      }}>重试</Button>} /> : page ? page.items.length ? <ul>
        {page.items.map(order => <li key={order.id}>
          {order.source === "direct_dispatch" ? "直接派单" : "客户端下单"} · {order.recipientGameAccount} · {order.requestedHearts} 颗
          {order.customerLinkStatus === "verified" ? ` · 老板 ${order.customerUserId}`
            : order.customerLinkStatus === "pending_verification" ? " · 老板归属待核" : ""} · <code>{order.id}</code>
          {order.customerActivationAvailable && <CustomerActivation route={`clubs/${clubId}/orders/${order.id}`} />}
        </li>)}
      </ul> : <Empty description="暂无俱乐部订单" /> : <Spin aria-label="加载订单" />}
      {after || page?.nextCursor ? <Flex gap="small">
        <Button disabled={!after} onClick={() => goTo()}>返回首页</Button>
        <Button disabled={!page?.nextCursor} onClick={() => goTo(page?.nextCursor ?? undefined)}>下一页</Button>
      </Flex> : null}
    </Card>
    {creating ? <NewDirectDraft clubId={clubId} onClose={() => setCreating(false)} onCreated={() => {
      setCreating(false);
      goTo();
      setRevision(value => value + 1);
    }} /> : null}
  </>;
}
