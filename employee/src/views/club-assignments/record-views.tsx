import { ArrowDownOutlined, ArrowUpOutlined, CalendarOutlined, RightOutlined } from "@ant-design/icons";
import { useWorkspaceScroll } from "../workspace-scroll";
import { type AssignmentRow, assignmentStatus, assignmentStatuses, isGiftAssignment, ownGiftHearts, scheduleLabel, totalHearts } from "./types";

export type OpenOrder = (id: string) => void;
export type SortKey = "name" | "hearts" | "observed" | "endDate";
export type TableSort = { key: SortKey; descending: boolean };

export function StatusLabel({ order }: { order: AssignmentRow }) {
  const status = assignmentStatus(order);
  return <span className="assignment-status" data-status={status}>{assignmentStatuses[status]}</span>;
}

export function AssignmentTitle({ order }: { order: AssignmentRow }) {
  return <span className="assignment-title"><strong>{order.recipientGameAccount}</strong>
    <code className="club-order-number">{order.id}</code></span>;
}

export function PersonalProgress({ order }: { order: AssignmentRow }) {
  if (isGiftAssignment(order)) {
    const p = order.giftProgress;
    return <span className="assignment-progress">
      <span>已送 <strong>{p.deliveredGiftTimes} / {p.acceptedGiftTimes}</strong> 次</span>
      <span>剩余 {p.remainingGiftTimes} 次</span><span>实际到账 {ownGiftHearts(p)}</span>
      {p.reportSyncPending ? <span>日报待同步</span> : null}
    </span>;
  }
  const progress = order.delivery;
  const target = totalHearts(order);
  const credited = progress?.myCreditedHearts ?? 0;
  const observed = progress?.myObservedHearts ?? 0;
  return <span className="assignment-progress">
    <span>本人到账 <strong>{observed} / {target}</strong> 颗</span>
    {String(observed) !== String(credited) ? <span>已抵扣 {credited} 颗</span> : null}
    <span>{progress?.myStoppedHearts !== undefined ? `已停送 ${progress.myStoppedHearts}` : `剩余 ${progress?.myRemainingHearts ?? target}`} 颗</span>
    {progress?.myPendingReports ? <span>{progress.myPendingReports} 条日报待核对</span> : null}
    {progress?.myReportSyncPending ? <span>日报待同步</span> : null}
  </span>;
}

export function AssignmentList({ orders, onOpen }: { orders: AssignmentRow[]; onOpen: OpenOrder }) {
  return <ul className="assignment-list">{orders.map(order => <li key={order.id}>
    <button type="button" data-assignment={order.id} className="assignment-list-row" onClick={() => onOpen(order.id)}>
      <AssignmentTitle order={order} /><StatusLabel order={order} /><PersonalProgress order={order} />
      <span className="assignment-date"><CalendarOutlined /> {scheduleLabel(order.personalSchedule)}</span>
      <RightOutlined className="assignment-chevron" />
    </button>
  </li>)}</ul>;
}

const columns: { key: SortKey; label: string }[] = [
  { key: "name", label: "订单名称" }, { key: "hearts", label: "我的份额" },
  { key: "observed", label: "实际到账" }, { key: "endDate", label: "本人排期" },
];

function compareRows(first: AssignmentRow, second: AssignmentRow, key: SortKey) {
  switch (key) {
    case "name": return first.recipientGameAccount.localeCompare(second.recipientGameAccount, "zh-CN");
    case "hearts": {
      if (isGiftAssignment(first)) return isGiftAssignment(second) ? first.giftProgress.acceptedGiftTimes - second.giftProgress.acceptedGiftTimes : -1;
      return isGiftAssignment(second) ? 1 : totalHearts(first) - totalHearts(second);
    }
    case "observed": {
      const delivered = (row: AssignmentRow) => BigInt(isGiftAssignment(row) ? row.giftProgress.knownReceivedHearts : row.delivery?.myObservedHearts ?? 0);
      const a = delivered(first), b = delivered(second);
      return a > b ? 1 : a < b ? -1 : 0;
    }
    case "endDate": return (first.personalSchedule.endDate ?? "").localeCompare(second.personalSchedule.endDate ?? "");
  }
}

export function AssignmentTable({ orders, sort, onSort, onOpen, scrollKey }: {
  orders: AssignmentRow[]; sort: TableSort; onSort: (sort: TableSort) => void; onOpen: OpenOrder; scrollKey: string;
}) {
  const scroll = useWorkspaceScroll<HTMLDivElement>(scrollKey, true, "scrollLeft");
  const sorted = [...orders].sort((first, second) => {
    if (sort.key === "endDate" && !!first.personalSchedule.endDate !== !!second.personalSchedule.endDate) {
      return first.personalSchedule.endDate ? -1 : 1;
    }
    return (sort.descending ? -1 : 1) * compareRows(first, second, sort.key);
  });
  const header = ({ key, label }: (typeof columns)[number]) => <th key={key} scope="col" aria-sort={sort.key === key
    ? sort.descending ? "descending" : "ascending" : undefined}>
    <button type="button" onClick={() => onSort({ key, descending: sort.key === key ? !sort.descending : false })}>
      {label} {sort.key === key ? sort.descending ? <ArrowDownOutlined /> : <ArrowUpOutlined /> : null}
    </button>
  </th>;
  return <div className="assignment-overflow" role="region" aria-label="承接属性表" tabIndex={0} {...scroll}>
    <table className="assignment-table">
      <thead><tr>{header(columns[0])}<th scope="col">状态</th>{columns.slice(1).map(header)}<th scope="col">本人余量</th></tr></thead>
      <tbody>{sorted.map(order => <tr key={order.id}>
        <th scope="row"><button type="button" data-assignment={order.id} onClick={() => onOpen(order.id)}><AssignmentTitle order={order} /></button></th>
        <td><StatusLabel order={order} /></td>
        {isGiftAssignment(order) ? <>
          <td>{order.giftProgress.acceptedGiftTimes} 次 · 已送 {order.giftProgress.deliveredGiftTimes} 次</td>
          <td>{ownGiftHearts(order.giftProgress)}</td>
          <td>{scheduleLabel(order.personalSchedule)}</td>
          <td>{order.giftProgress.remainingGiftTimes} 次</td>
        </> : <>
          <td>{totalHearts(order)} 颗 · {order.shares.length} 份</td>
          <td>{order.delivery?.myObservedHearts ?? 0} 颗{order.delivery?.myPendingReports ? <small> · 待核对 {order.delivery.myPendingReports} 条</small> : null}
            {order.delivery?.myReportSyncPending ? <small> · 待同步</small> : null}</td>
          <td>{scheduleLabel(order.personalSchedule)}</td>
          <td>{order.delivery?.myStoppedHearts !== undefined ? `已停送 ${order.delivery.myStoppedHearts}` : order.delivery?.myRemainingHearts ?? totalHearts(order)} 颗</td>
        </>}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function AssignmentKanban({ orders, onOpen, scrollKey }: {
  orders: AssignmentRow[]; onOpen: OpenOrder; scrollKey: string;
}) {
  const scroll = useWorkspaceScroll<HTMLDivElement>(scrollKey, true, "scrollLeft");
  const groups = new Map<keyof typeof assignmentStatuses, AssignmentRow[]>();
  for (const order of orders) {
    const status = assignmentStatus(order);
    const group = groups.get(status);
    if (group) group.push(order);
    else groups.set(status, [order]);
  }
  return <div className="assignment-overflow" role="region" aria-label="本人进度看板" tabIndex={0} {...scroll}>
    <div className="assignment-kanban">{Object.entries(assignmentStatuses).map(([status, label]) => {
      const items = groups.get(status as keyof typeof assignmentStatuses) ?? [];
      return <section key={status} className="assignment-kanban-column" aria-label={label}>
        <h2><span className="assignment-status" data-status={status}>{label}</span> <small>{items.length}</small></h2>
        {items.map(order => <button type="button" key={order.id} data-assignment={order.id} onClick={() => onOpen(order.id)}>
          <AssignmentTitle order={order} /><PersonalProgress order={order} />
          <span className="assignment-date"><CalendarOutlined /> {scheduleLabel(order.personalSchedule)}</span>
        </button>)}
      </section>;
    })}</div>
  </div>;
}
