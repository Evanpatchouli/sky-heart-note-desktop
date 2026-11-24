import { useEffect, useMemo } from "react";
import classNames from "classnames";
import dayjs from "dayjs";
import useEmitter from "#/utils/useEmitter";
import useHomeStore from "#/views/home/store";
import { bookingDates, CNDateToDateString } from "#/utils";
import { useSharedValue } from "#/plugins/share";
import "./index.css";

export default function HeartExpressTimeline() {
  const emitter = useEmitter();
  const bookings = useHomeStore(state => state.bookings);
  const today = dayjs().format("YYYY-MM-DD");
  const [selectedDate, setSelectedDate] = useSharedValue("timeline.selectedDate", today);
  const { rows, earliest, dates } = useMemo(() => {
    const current = dayjs(today);
    let earliest = current;
    let latest = current;
    const rows = bookings.map(record => {
      const [first, last] = bookingDates(record.date);
      const parsedStart = dayjs(CNDateToDateString(first));
      const start = parsedStart.isValid() ? parsedStart : current;
      const parsedEnd = dayjs(CNDateToDateString(last));
      const end = parsedEnd.isValid() && parsedEnd.isAfter(start) ? parsedEnd : start;
      if (start.isBefore(earliest)) earliest = start;
      if (end.isAfter(latest)) latest = end;
      return { record, start, end };
    });
    const dates = Array.from({ length: Math.max(30, latest.diff(earliest, "day") + 1) }, (_, day) => earliest.add(day, "day").format("YYYY-MM-DD"));
    return { rows, earliest, dates };
  }, [bookings, today]);
  useEffect(() => {
    document.getElementById("today")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [today]);
  return <div className="heartexpress-timeline" id="heartexpress-timeline" style={{ overflow: "auto", height: "100%" }}>
    <div style={{ position: "relative", minWidth: dates.length * 40 }}>
      <div style={{ display: "flex", height: 25, borderBottom: "1px solid #303030" }}>
        {dates.map(date => <button key={date} className={classNames("date-item", { selected: selectedDate === date })}
          id={date === today ? "today" : undefined} title={date} onClick={() => setSelectedDate(date)}>{Number(date.slice(-2))}</button>)}
      </div>
      {dates.map((date, index) => <div aria-hidden key={date} style={{
        position: "absolute", top: 26, left: index * 40 + 20, height: rows.length * 28, width: 1,
        backgroundColor: selectedDate === date ? "red" : "#f0f0f0", pointerEvents: "none",
      }} />)}
      {rows.map(({ record, start, end }) => <div key={record.id} style={{ height: 28 }}>
        <button className="booking-item" style={{ position: "relative", marginLeft: start.diff(earliest, "day") * 40,
          width: (end.diff(start, "day") + 1) * 40, whiteSpace: "nowrap", textAlign: "left" }}
          onClick={() => emitter.emit({ type: "OPEN_BOOKING_DETAIL_DIALOG_REQUEST", payload: { type: "EDIT", record } })}>
          {record.title}
        </button>
      </div>)}
    </div>
  </div>;
}
