import { BellOutlined } from "@ant-design/icons";
import { useAuthSession } from "@sky-club/common/web-auth";
import { NotificationBell, notificationReadEvent } from "@sky-club/common/notifications";
import { dispatchNoticeReadEvent } from "#/service/dispatch-notices";
import useEmitter from "#/utils/useEmitter";

export default function DispatchNotices() {
  const { token } = useAuthSession();
  const { useSubscription } = useEmitter();
  useSubscription(dispatchNoticeReadEvent, () => window.dispatchEvent(new Event(notificationReadEvent)));
  return <NotificationBell app="employee" token={token} icon={<BellOutlined />} className="member-appbar__notices" />;
}
