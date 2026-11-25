import { useEffect, useState } from "react";
import { Alert } from "antd";
import { Link } from "react-router";
import { getAppToken, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

type ClientOrderNotice = { orderId: string; clubId: string; clubName: string; recipientGameAccount: string; createdAt: string };

export function useClientOrderNotices(open: boolean) {
  const { token } = useAuthSession();
  const [items, setItems] = useState<ClientOrderNotice[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active: AbortController | undefined;
    function refresh() {
      if (document.visibilityState === "hidden" || getAppToken("employee") !== token) return;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      employeeRequest<ClientOrderNotice[]>("clubs/client-order-notices", "GET", undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) { setItems(value); setError(false); } })
        .catch(() => { if (!controller.signal.aborted) setError(true); });
    }
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, token]);
  return { items, error };
}

export function ClientOrderNoticeList({ items, error, onSelect }: ReturnType<typeof useClientOrderNotices> & { onSelect: () => void }) {
  if (error) return <Alert type="error" title="客户端下单通知读取失败" />;
  if (!items.length) return <p>暂无待接待的客户端订单。</p>;
  return <ul>{items.map(item => <li key={item.orderId}>
    <Link to={{ pathname: "/club/dispatch", search: new URLSearchParams({ clubId: item.clubId, orderId: item.orderId }).toString() }}
      onClick={onSelect}>{item.clubName} · {item.recipientGameAccount} · 核对报价</Link>
  </li>)}</ul>;
}
