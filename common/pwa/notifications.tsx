import { useEffect, useRef, useState, type ReactNode } from "react";
import { getAppToken, RequestError, type WebApp } from "../web-auth/api";
import NotificationPush from "./notification-push";
import { notificationRequest } from "./notification-request";
import "./notifications.css";

export { notificationRequest };

export interface InboxNotice {
  id: string;
  title: string;
  body?: string;
  type: "normal" | "important";
  target: "inbox" | "claim-board" | "client-order-assigned";
  href: string | null;
  orderId?: string;
  publishedAt: string;
  readAt: string | null;
}

type NoticePage = { items: InboxNotice[]; hasUnread: boolean; nextCursor: string | null };
const objectId = /^[0-9a-f]{24}$/i;
export const notificationReadEvent = "sky-heart:notification-read";
const date = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export function NotificationBell({ app, token, icon, className }: {
  app: WebApp; token: string; icon?: ReactNode; className?: string;
}) {
  const query = new URLSearchParams(location.search);
  const linkedId = query.get("noticeId");
  const hasLink = query.get("notifications") === "1" || location.pathname === "/" && !!linkedId;
  const [open, setOpen] = useState(() => hasLink);
  const [selectedId, setSelectedId] = useState(() => hasLink && linkedId && objectId.test(linkedId) ? linkedId : "");
  const [selected, setSelected] = useState<InboxNotice>();
  const [page, setPage] = useState<NoticePage>();
  const [after, setAfter] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [unread, setUnread] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [marking, setMarking] = useState("");
  const [markError, setMarkError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    let request: AbortController | undefined;
    const load = () => {
      if (document.visibilityState === "hidden" || getAppToken(app) !== token) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const query = new URLSearchParams({ limit: open ? "25" : "1" });
      if (open && after) query.set("after", after);
      notificationRequest<NoticePage>(app, token, "notifications?" + query, "GET", undefined, controller.signal)
        .then(data => {
          if (controller.signal.aborted || getAppToken(app) !== token) return;
          setUnread(data.hasUnread);
          if (open) { setPage(data); setError(""); }
        }).catch(err => {
          if (open && !controller.signal.aborted && getAppToken(app) === token) setError(message(err, "通知加载失败"));
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("focus", load);
    window.addEventListener(notificationReadEvent, load);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("focus", load);
      window.removeEventListener(notificationReadEvent, load);
    };
  }, [app, token, open, after, refresh]);

  useEffect(() => {
    if (!open || !selectedId) return;
    const controller = new AbortController();
    notificationRequest<InboxNotice>(app, token, "notifications/" + selectedId, "GET", undefined, controller.signal)
      .then(data => {
        if (!controller.signal.aborted && getAppToken(app) === token) { setSelected(data); setDetailError(""); }
      }).catch(err => {
        if (!controller.signal.aborted && getAppToken(app) === token) {
          setDetailError(message(err, "通知详情加载失败"));
        }
      });
    return () => controller.abort();
  }, [app, token, open, selectedId, refresh]);

  function changePage(next?: string) {
    setAfter(next);
    setPage(undefined);
    setError("");
    setRefresh(value => value + 1);
  }

  async function markRead(notice: InboxNotice) {
    setMarking(notice.id);
    setMarkError("");
    try {
      await notificationRequest(app, token, `notifications/${notice.id}/read`, "PATCH");
      if (getAppToken(app) !== token) return;
      if (selectedId === notice.id && notice.type === "normal") {
        setSelected(undefined);
        setSelectedId("");
      }
      setRefresh(value => value + 1);
    } catch (err) {
      if (getAppToken(app) === token) setMarkError(message(err, "标记已读失败"));
    } finally {
      setMarking("");
    }
  }

  function close() {
    setOpen(false);
    setSelectedId("");
    setSelected(undefined);
    setDetailError("");
    if (hasLink) {
      query.delete("noticeId");
      query.delete("notifications");
      const search = query.size ? "?" + query : "";
      window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash);
    }
    button.current?.focus();
  }

  function noticeRow(notice: InboxNotice) {
    return <>
      <div className="sky-notice-summary">
        <strong>{notice.title}</strong>
        {notice.type === "important" ? <span className="sky-notice-priority">重要</span> : null}
        <span>{notice.readAt ? "已读" : "未读"}</span>
      </div>
      {notice.body ? <p>{notice.body}</p> : null}
      {notice.orderId ? <code>{notice.orderId}</code> : null}
      <time dateTime={notice.publishedAt}>{date.format(new Date(notice.publishedAt))}</time>
      <div className="sky-notice-actions">
        {notice.href ? <a href={notice.href}>{notice.target === "claim-board" ? "前往接单区" : "前往派单准备"}</a> : null}
        {notice.readAt === null ? <button type="button" disabled={!!marking} onClick={() => void markRead(notice)}>标为已读</button> : null}
      </div>
    </>;
  }

  const label = unread ? "通知，有未读" : "通知";
  return <>
    <button type="button" ref={button} className={["sky-notice-bell", className].filter(Boolean).join(" ")}
      aria-haspopup="dialog" aria-expanded={open} aria-label={label}
      onClick={() => { changePage(); setOpen(true); }}>
      {icon ?? "通知"}{unread ? <span aria-hidden="true" className="sky-notice-dot" /> : null}
    </button>
    <dialog ref={dialog} className="sky-notice-dialog" aria-label="通知" onClose={close}>
      <div className="sky-notice-dialog-heading">
        <h2>通知</h2>
        <button type="button" onClick={() => dialog.current?.close()}>关闭</button>
      </div>
      <NotificationPush app={app} token={token} open={open} />
      {selected ? <article aria-label="打开的通知" className="sky-notice-selected">{noticeRow(selected)}</article> : null}
      {detailError ? <p role="alert">{detailError}</p> : null}
      {markError ? <p role="alert">{markError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {page ? page.items.length ? <ul className="sky-notice-list">
        {page.items.filter(notice => notice.id !== selected?.id).map(notice => <li key={notice.id}>{noticeRow(notice)}</li>)}
      </ul> : <p>暂无通知。</p> : !error ? <p role="status">正在加载通知…</p> : null}
      <div className="sky-notice-actions">
        {after ? <button type="button" onClick={() => changePage()}>返回首页</button> : null}
        {page?.nextCursor ? <button type="button" onClick={() => changePage(page.nextCursor ?? undefined)}>下一页</button> : null}
        <button type="button" onClick={() => changePage(after)}>{error ? "重试" : "刷新"}</button>
      </div>
    </dialog>
  </>;
}

function message(error: unknown, fallback: string) {
  return error instanceof RequestError ? error.message : fallback;
}
