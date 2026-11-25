import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { notificationReadEvent, notificationRequest, type InboxNotice } from "@webapp-template/common/notifications";

const objectId = /^[a-f0-9]{24}$/i;

export function useDispatchNotificationTarget() {
  const { token } = useAuthSession();
  const [params, setParams] = useSearchParams();
  const id = params.get("notificationId");
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id || !objectId.test(id)) return;
    const controller = new AbortController();
    const path = "notifications/" + id;
    notificationRequest<InboxNotice>("employee", token, path, "GET", undefined, controller.signal)
      .then(async notice => {
        if (controller.signal.aborted) return;
        if (notice.target !== "client-order-assigned" || !notice.orderId || !objectId.test(notice.orderId)) {
          throw new Error("找不到该通知对应的订单");
        }
        if (!notice.readAt) {
          await notificationRequest("employee", token, path + "/read", "PATCH", undefined, controller.signal);
          window.dispatchEvent(new Event(notificationReadEvent));
        }
        if (controller.signal.aborted) return;
        setParams(current => {
          const next = new URLSearchParams(current);
          next.delete("notificationId");
          next.set("orderId", notice.orderId!);
          return next;
        }, { replace: true });
      })
      .catch(error => {
        if (!controller.signal.aborted) setFailure({
          id, message: error instanceof RequestError ? error.message : "无法打开通知对应的订单",
        });
      });
    return () => controller.abort();
  }, [id, token, attempt, setParams]);

  return {
    error: !id ? "" : !objectId.test(id) ? "通知链接无效" : failure?.id === id ? failure.message : "",
    loading: !!id && objectId.test(id) && failure?.id !== id,
    retry: () => { setFailure(undefined); setAttempt(value => value + 1); },
  };
}
