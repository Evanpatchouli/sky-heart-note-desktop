import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { usePhoneWidth } from "@webapp-template/common/mobile-navigation";
import { CalendarOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useWorkspaceScroll } from "../workspace-scroll";
import { type AssignmentRow, assignmentStatus, assignmentStatuses, isGiftAssignment, ownGiftHearts, scheduleLabel, type ScheduleDates } from "./types";
import { AssignmentList, AssignmentTitle, PersonalProgress, type OpenOrder } from "./record-views";

const dayMs = 86_400_000;
const weekdays = Array.from("一二三四五六日");
const daySize = 40;
const dateFormatter = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" });

export function businessToday() {
  return dateFormatter.format(new Date());
}

const toDay = (value: string) => Date.parse(`${value}T00:00:00Z`) / dayMs;
const utcDate = (day: number) => new Date(day * dayMs);
const stamp = (day: number) => utcDate(day).toISOString().split("T")[0];
const weekDay = (day: number) => (utcDate(day).getUTCDay() + 6) % 7;
const monthStart = (day: number, offset = 0) => {
  const date = utcDate(day);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.valueOf() / dayMs;
};
const minDay = toDay("0001-01-01"), maxDay = toDay("9999-12-31");
const daysFrom = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);
const intersection = (row: DatedOrder, first: number, last: number) => row.from <= last && row.to >= first;

type DatedOrder = { order: AssignmentRow; from: number; to: number };
type EditSchedule = (order: AssignmentRow, proposed: ScheduleDates) => void;

export function AssignmentDates({ mode, orders, date, onDate, onOpen, onEdit, scrollKey }: {
  mode: "timeline" | "calendar"; orders: AssignmentRow[]; date: string;
  onDate: (date: string) => void; onOpen: OpenOrder; onEdit: EditSchedule; scrollKey: string;
}) {
  const today = businessToday();
  const selected = toDay(date);
  const start = monthStart(selected);
  const nextMonth = monthStart(selected, 1);
  const dated: DatedOrder[] = [];
  const unscheduled: AssignmentRow[] = [];
  for (const order of orders) {
    const { startDate, endDate } = order.personalSchedule;
    if (startDate && endDate) dated.push({ order, from: toDay(startDate), to: toDay(endDate) });
    else unscheduled.push(order);
  }
  dated.sort((a, b) => a.from - b.from || a.to - b.to);

  function selectDay(day: number, focus?: HTMLElement) {
    if (day < minDay || day > maxDay) return;
    onDate(stamp(day));
    if (focus) requestAnimationFrame(() => {
      focus.querySelector<HTMLElement>(`[data-assignment-day="${stamp(day)}"]`)?.focus({ preventScroll: true });
    });
  }

  function handleDayKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement)) return;
    const focusedDay = event.target.closest<HTMLElement>("[data-assignment-day]")?.dataset.assignmentDay;
    if (!focusedDay) return;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    selectDay(toDay(focusedDay) + offset, event.currentTarget);
  }

  function dateButton(day: number, count?: number) {
    const dayStamp = stamp(day);
    const weekday = weekdays[weekDay(day)];
    return <button key={day} type="button" className="assignment-day" data-assignment-day={dayStamp} data-outside={day < start || day >= nextMonth}
      aria-label={`${dayStamp} 周${weekday}${count === undefined ? "" : `，${count} 笔承接`}`}
      tabIndex={day === selected ? 0 : -1} disabled={day < minDay || day > maxDay}
      aria-current={dayStamp === today ? "date" : undefined} aria-pressed={day === selected}
      onClick={() => selectDay(day)}>
      {mode === "timeline" ? <small>{weekday}</small> : null}
      <span>{utcDate(day).getUTCDate()}</span>
      {count ? <small className="assignment-day-count">{count} 笔</small> : null}
    </button>;
  }

  return <>
    <div className="assignment-date-toolbar">
      <h2>{utcDate(start).getUTCFullYear()} 年 {utcDate(start).getUTCMonth() + 1} 月</h2>
      <label>定位日期<input type="date" aria-label="定位日期" min="0001-01-01" max="9999-12-31" value={date}
        onChange={event => { if (event.target.value && event.target.validity.valid) onDate(event.target.value); }} /></label>
      <div className="assignment-month-controls" role="group" aria-label="月份导航">
        <button type="button" aria-label="上个月" onClick={() => selectDay(monthStart(start, -1))} disabled={start === minDay}><LeftOutlined /></button>
        <button type="button" onClick={() => onDate(today)}>今天</button>
        <button type="button" aria-label="下个月" onClick={() => selectDay(nextMonth)} disabled={nextMonth > maxDay}><RightOutlined /></button>
      </div>
    </div>
    <div onKeyDown={handleDayKey}>
      {mode === "timeline" ? <Timeline rows={dated} selected={selected} start={start} nextMonth={nextMonth}
        dateButton={dateButton} onOpen={onOpen} onEdit={onEdit} onJump={selectDay} scrollKey={scrollKey} />
        : <Calendar rows={dated} selected={selected} start={start} nextMonth={nextMonth} dateButton={dateButton} onOpen={onOpen} />}
    </div>
    <section className="assignment-date-agenda" aria-label="未排期">
      <h2>未排期 <small>{unscheduled.length} 笔</small></h2>
      {unscheduled.length ? <AssignmentList orders={unscheduled} onOpen={onOpen} /> : null}
    </section>
  </>;
}

type DateViewProps = {
  rows: DatedOrder[]; selected: number; start: number; nextMonth: number;
  dateButton: (day: number, count?: number) => React.ReactNode;
  onOpen: OpenOrder;
};

function Timeline({ rows, selected, start, nextMonth, dateButton, onOpen, onEdit, onJump, scrollKey }: DateViewProps & {
  onEdit: EditSchedule; onJump: (day: number) => void; scrollKey: string;
}) {
  const first = Math.max(start - 3, minDay), last = Math.min(nextMonth + 2, maxDay);
  const days = daysFrom(first, last - first + 1);
  const scroll = useWorkspaceScroll<HTMLDivElement>(`${scrollKey}:${selected}`, true, "scrollLeft", target => {
    const nameWidth = target.querySelector<HTMLElement>(".assignment-timeline-name")?.offsetWidth ?? 0;
    return Math.max(0, (selected - first) * daySize - (target.clientWidth - nameWidth - daySize) / 2);
  });
  return <>
    <div className="assignment-overflow assignment-timeline-scroll" role="region" aria-label="可横向滚动的排期时间轴" tabIndex={0} {...scroll}>
      <div className="assignment-timeline" style={{ "--assignment-days": days.length, "--assignment-day-width": `${daySize}px` } as CSSProperties}>
        <div className="assignment-timeline-row assignment-timeline-head">
          <div className="assignment-timeline-name">订单名称</div>
          <div className="assignment-timeline-lane">{days.map(day => dateButton(day))}</div>
        </div>
        {rows.map(row => <div key={row.order.id} className="assignment-timeline-row">
          <div className="assignment-timeline-name">
            <button type="button" data-assignment={row.order.id} onClick={() => onOpen(row.order.id)}><AssignmentTitle order={row.order} /><PersonalProgress order={row.order} /></button>
            {!intersection(row, first, last) ? <button type="button" className="assignment-jump"
              onClick={() => onJump(row.from)} aria-label={`定位 ${row.order.recipientGameAccount} 的排期`}><CalendarOutlined /></button> : null}
          </div>
          <div className="assignment-timeline-lane">
            {intersection(row, first, last) ? <TimelineBar row={row} first={first} last={last} onOpen={onOpen} onEdit={onEdit} /> : null}
          </div>
        </div>)}
      </div>
    </div>
    {!rows.length ? <p className="assignment-date-empty">当前没有已排期的承接订单</p> : null}
  </>;
}

function TimelineBar({ row, first, last, onOpen, onEdit }: { row: DatedOrder; first: number; last: number; onOpen: OpenOrder; onEdit: EditSchedule }) {
  const drag = useRef<{ start: number; kind: "move" | "start" | "end" }>(undefined);
  const [offset, setOffset] = useState(0);
  const dragged = useRef(false);
  const status = assignmentStatus(row.order);
  const from = Math.max(first, row.from), to = Math.min(last, row.to);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragged.current = false;
    if (event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
    const handle = (event.target as HTMLElement).dataset.scheduleHandle;
    drag.current = { start: event.clientX, kind: handle === "start" || handle === "end" ? handle : "move" };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || Math.abs(event.clientX - gesture.start) < 5) return;
    const days = Math.round((event.clientX - gesture.start) / daySize);
    if (days) dragged.current = true;
    setOffset(days);
  }

  function release(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    drag.current = undefined;
    setOffset(0);
    if (!gesture) return;
    const days = Math.round((event.clientX - gesture.start) / daySize);
    if (!days) return;
    dragged.current = true;
    const start = gesture.kind === "end" ? row.from : row.from + days;
    const end = gesture.kind === "start" ? row.to : row.to + days;
    const validStart = Math.min(maxDay, Math.max(minDay, start));
    const validEnd = Math.max(validStart, Math.min(maxDay, end));
    onEdit(row.order, { startDate: stamp(gesture.kind === "start" ? Math.min(validStart, row.to) : validStart), endDate: stamp(gesture.kind === "start" ? row.to : validEnd) });
  }

  const label = `${row.order.recipientGameAccount} · ${scheduleLabel(row.order.personalSchedule)} · ${assignmentStatuses[status]}`;
  const kind = drag.current?.kind;
  const delta = offset * daySize;
  const growth = kind === "start" ? -delta : delta;
  return <button type="button" className="assignment-timeline-bar" data-status={status} data-assignment={row.order.id}
    title={label} aria-label={label} style={{ gridColumn: `${from - first + 1} / span ${to - from + 1}`,
      transform: offset && kind !== "end" ? `translateX(${delta}px)` : undefined,
      width: offset && kind !== "move" ? `max(28px, calc(100% ${growth < 0 ? "-" : "+"} ${Math.abs(growth)}px))` : undefined }}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={release}
    onPointerCancel={() => { drag.current = undefined; setOffset(0); }}
    onClick={event => {
      if (!dragged.current || event.detail === 0) onOpen(row.order.id);
      dragged.current = false;
    }}>
    {row.from >= first ? <span className="assignment-handle" data-schedule-handle="start" aria-hidden="true" /> : null}
    <span className="assignment-bar-name">{row.order.recipientGameAccount}</span>
    {row.to <= last ? <span className="assignment-handle" data-schedule-handle="end" aria-hidden="true" /> : null}
  </button>;
}

function Calendar({ rows, selected, start, nextMonth, dateButton, onOpen }: DateViewProps) {
  const phone = usePhoneWidth();
  const first = start - weekDay(start);
  const weeks = Math.ceil((nextMonth - first) / 7);
  const agenda = rows.filter(row => intersection(row, selected, selected));
  return <>
    <div className="assignment-calendar-scroll">
      <div className="assignment-calendar" aria-label="承接月历">
        <div className="assignment-calendar-weekdays">{weekdays.map(day => <span key={day}>周{day}</span>)}</div>
        {Array.from({ length: weeks }, (_, index) => {
          const weekStart = first + index * 7;
          const days = daysFrom(weekStart, 7);
          const visible = rows.filter(row => intersection(row, weekStart, weekStart + 6));
          return <div className="assignment-calendar-week" key={weekStart}>
            <div className="assignment-calendar-days">{days.map(day => dateButton(day, visible.filter(row => intersection(row, day, day)).length))}</div>
            {!phone && <CalendarBands rows={visible} start={weekStart} onOpen={onOpen} />}
          </div>;
        })}
      </div>
    </div>
    <section className="assignment-date-agenda" aria-label="所选日期的承接订单">
      <h2>{stamp(selected)} · 周{weekdays[weekDay(selected)]} <small>{agenda.length} 笔承接</small></h2>
      {agenda.length ? <AssignmentList orders={agenda.map(({ order }) => order)} onOpen={onOpen} />
        : <p className="assignment-date-empty">这一天没有排期</p>}
    </section>
  </>;
}

function CalendarBands({ rows, start, onOpen }: { rows: DatedOrder[]; start: number; onOpen: OpenOrder }) {
  const laneEnds: number[] = [];
  return <div className="assignment-calendar-bands">{rows.map(row => {
    const from = Math.max(row.from, start), to = Math.min(row.to, start + 6);
    const free = laneEnds.findIndex(end => end < from);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = to;
    const order = row.order;
    const progress = isGiftAssignment(order)
      ? ` · 已送 ${order.giftProgress.deliveredGiftTimes}/${order.giftProgress.acceptedGiftTimes} 次 · 实际到账 ${ownGiftHearts(order.giftProgress)}` : "";
    const label = `${order.recipientGameAccount} · ${scheduleLabel(order.personalSchedule)}${progress}`;
    return <button type="button" key={row.order.id} data-status={assignmentStatus(row.order)} data-assignment={row.order.id}
      title={label} aria-label={label} style={{ gridColumn: `${from - start + 1} / span ${to - from + 1}`, gridRow: lane + 1 }}
      onClick={() => onOpen(order.id)}>{order.recipientGameAccount}
        {isGiftAssignment(order) ? ` · ${order.giftProgress.deliveredGiftTimes}/${order.giftProgress.acceptedGiftTimes} 次` : null}</button>;
  })}</div>;
}
