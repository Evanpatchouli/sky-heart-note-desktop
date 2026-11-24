import { useEffect, useState } from "react";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" });
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function Timenow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <time className="member-clock" dateTime={now.toISOString()} title={now.toLocaleString("zh-CN")}>
      <span className="member-clock__date">{dateFormatter.format(now)}</span>
      <span className="member-clock__time">{timeFormatter.format(now)}</span>
    </time>
  );
}
