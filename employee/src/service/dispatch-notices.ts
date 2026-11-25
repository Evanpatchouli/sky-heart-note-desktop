export const dispatchNoticesRoute = "dispatch-notices";
export const dispatchNoticeReadEvent = "DISPATCH_NOTICE_READ";

export function dispatchNoticeRoute(noticeId: string) {
  return `${dispatchNoticesRoute}/${encodeURIComponent(noticeId)}`;
}
