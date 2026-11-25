import { useEffect, useState } from "react";
import { BellOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Empty, Flex, Modal, Spin, Tag } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { dispatchNoticeRoute, dispatchNoticesRoute } from "#/service/dispatch-notices";
import { employeeRequest } from "#/service/request";
import { ClientOrderNoticeList, useClientOrderNotices } from "./ClientOrderNotices";

type Notice = {
  id: string;
  clubId: string;
  clubName: string;
  orderId: string;
  publishedAt: string;
  type: "important";
  readAt: string | null;
};

type Unread = { hasUnread: boolean };
type NoticePage = Unread & { items: Notice[]; nextCursor: string | null };

export default function DispatchNotices() {
  const { token } = useAuthSession();
  const [hasUnread, setHasUnread] = useState(false);
  const [open, setOpen] = useState(false);
  const clientOrders = useClientOrderNotices(open);
  const [page, setPage] = useState<NoticePage>();
  const [after, setAfter] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [unreadAttempt, setUnreadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [marking, setMarking] = useState<string>();

  useEffect(() => {
    let request: AbortController | undefined;
    const refreshUnread = () => {
      if (document.visibilityState === "hidden" || getAppToken("employee") !== token) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      employeeRequest<Unread>(dispatchNoticesRoute + "/unread", "GET", undefined, controller.signal)
        .then(result => {
          if (!controller.signal.aborted) setHasUnread(result.hasUnread);
        })
        .catch(() => {});
    };
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 30_000);
    window.addEventListener("focus", refreshUnread);
    document.addEventListener("visibilitychange", refreshUnread);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshUnread);
      document.removeEventListener("visibilitychange", refreshUnread);
    };
  }, [token, unreadAttempt]);

  useEffect(() => {
    if (!open || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const path = after ? dispatchNoticesRoute + "?after=" + encodeURIComponent(after) : dispatchNoticesRoute;
    employeeRequest<NoticePage>(path, "GET", undefined, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setPage(result);
          setHasUnread(result.hasUnread);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof RequestError ? err.message : "派单通知加载失败");
        }
      });
    return () => controller.abort();
  }, [open, after, attempt, token]);

  function loadPage(cursor?: string) {
    setPage(undefined);
    setError("");
    setReadError("");
    setAfter(cursor);
    setAttempt(value => value + 1);
  }

  async function markRead(noticeId: string) {
    if (getAppToken("employee") !== token) return;
    setMarking(noticeId);
    setReadError("");
    try {
      const { readAt } = await employeeRequest<{ readAt: string }>(`${dispatchNoticeRoute(noticeId)}/read`, "PATCH");
      if (getAppToken("employee") !== token) return;
      setPage(previous => previous && ({
        ...previous,
        items: previous.items.map(notice => notice.id === noticeId ? { ...notice, readAt } : notice),
      }));
      setUnreadAttempt(value => value + 1);
    } catch (err) {
      if (getAppToken("employee") === token) {
        setReadError(err instanceof RequestError ? err.message : "标记已读失败，请重试");
      }
    } finally {
      setMarking(undefined);
    }
  }

  return <>
    <Button type="text" className="member-appbar__notices" aria-haspopup="dialog"
      aria-expanded={open} aria-label={hasUnread ? "派单通知，有未读" : clientOrders.items.length ? "派单通知，有待接待的客户端订单" : "派单通知"}
      icon={<Badge dot={hasUnread || clientOrders.items.length > 0}><BellOutlined /></Badge>}
      onClick={() => { loadPage(); setOpen(true); }} />
    <Modal title="派单通知" open={open} footer={null} onCancel={() => setOpen(false)}
      styles={{ body: { maxHeight: "65dvh", overflowY: "auto" } }}>
      <Flex vertical gap="small">
        <section aria-label="客户端下单通知">
          <strong>待接待的客户端订单</strong>
          <ClientOrderNoticeList {...clientOrders} onSelect={() => setOpen(false)} />
        </section>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {readError ? <Alert type="error" showIcon title={readError} /> : null}
        {page ? page.items.length ? <ul className="member-dispatch-notice-list">
          {page.items.map(notice => <li key={notice.id}>
            <div className="member-dispatch-notice">
              <Flex gap="small" wrap align="center">
                <strong>新派单</strong>
                {notice.type === "important" ? <Tag color="gold">重要</Tag> : null}
                <Tag color={notice.readAt ? undefined : "blue"}>{notice.readAt ? "已读" : "未读"}</Tag>
              </Flex>
              <span>{notice.clubName} · <time dateTime={notice.publishedAt}>{dayjs(notice.publishedAt).format("YYYY-MM-DD HH:mm")}</time></span>
              <code className="club-order-number">{notice.orderId}</code>
              <Flex align="center" gap="middle" wrap>
                <Link className="member-dispatch-notice__link"
                  to={{ pathname: "/club/gift-claims", search: new URLSearchParams({ orderId: notice.orderId }).toString() }}
                  onClick={() => setOpen(false)}>查看按次派单</Link>
                {notice.readAt ? null : <Button loading={marking === notice.id} disabled={marking !== undefined}
                  onClick={() => void markRead(notice.id)}>标为已读</Button>}
              </Flex>
            </div>
          </li>)}
        </ul> : <Empty description="暂无派单通知" /> : !error ? <Spin aria-label="加载派单通知" /> : null}
        <Flex gap="small" wrap>
          {after ? <Button onClick={() => loadPage()}>返回首页</Button> : null}
          {page?.nextCursor ? <Button onClick={() => loadPage(page.nextCursor ?? undefined)}>下一页</Button> : null}
          <Button onClick={() => loadPage(after)}>{error ? "重试" : "刷新"}</Button>
        </Flex>
      </Flex>
    </Modal>
  </>;
}
