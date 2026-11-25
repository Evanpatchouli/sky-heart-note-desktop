export const dispatchNoticesRoute = "dispatch-notices";

export function dispatchNoticeRoute(noticeId: string) {
  return `${dispatchNoticesRoute}/${encodeURIComponent(noticeId)}`;
}
