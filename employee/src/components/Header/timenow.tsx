import { useEffect, useState } from "react";

const useCurrentTime = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return formatter.format(time);
};

export default function Timenow() {
  const currentTime = useCurrentTime();
  return (
    <div
      style={{
        paddingRight: "10px",
      }}
    >
      <span>{currentTime}</span>
    </div>
  );
}
