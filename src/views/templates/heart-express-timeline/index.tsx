import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import useEmitter from "#/utils/useEmitter";
import BookingDetailDialog from "#/components/booking-detail-dialog";
import "./index.css";
import { FloatButton, Menu } from "antd";
import { FileAddOutlined, ToolOutlined, ScanOutlined } from "@ant-design/icons";
import useHomeStore from "#/views/home/store";
import { CNDateToDateString, sleep } from "#/utils";
import { ZongheFenxiDialog } from "#/components/zonghe-fenxi-dialog";
import OverviewDialog from "#/components/overview-dialog";
import omit from "#/utils/omit";

interface ItemType {
  id: number;
  title: string;
  earliestDate?: Date;
  date: string;
}

const BookingItem = (props: ItemType) => {
  const emitter = useEmitter();
  const calDiffDays = (startDate: string) => {
    const earliest = new Date(props.earliestDate || new Date().toISOString().split("T")[0]);
    earliest.setHours(0, 0, 0, 0); // 设置为当天的午夜
    const start = new Date(CNDateToDateString(startDate));
    start.setHours(0, 0, 0, 0); // 设置为开始日期的午夜
    const diffTime = Math.abs(earliest.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };
  const calculateMarginLeft = (startDate: string) => {
    return calDiffDays(startDate) * 40; // 每天差异8px
  };
  const calDuration = (startDate: string, endDate: string) => {
    // 只计算天数
    const start = new Date(CNDateToDateString(startDate));
    const end = new Date(CNDateToDateString(endDate));
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };
  const calculateWidth = (startDate: string, endDate: string) => {
    return (calDuration(startDate, endDate) + 1) * 40;
  };

  const isDraggingRef = useRef(false);

  const start = props.date?.split("-")[0];
  const end = props.date?.split("-")[1] || start;

  return (
    <div
      className="booking-item"
      style={{
        marginLeft: calculateMarginLeft(start),
        width: calculateWidth(start, end),
        overflow: "visible", // 设置溢出可见
        whiteSpace: "nowrap", // 设置不换行
        marginBottom: 2,
      }}
      onPointerUp={(_e) => {
        if (!isDraggingRef.current) {
          emitter.emit({
            type: "OPEN_BOOKING_DETAIL_DIALOG_REQUEST",
            payload: {
              record: omit(props, ["earliestDate"]),
              type: "EDIT",
            },
          });
        }
      }}
    >
      {props.title}
    </div>
  );
};

export default function HeartExpressTimeline() {
  const emitter = useEmitter();
  const { bookings } = useHomeStore();
  const data = bookings;
  const earliestDate = new Date(
    Math.min(
      ...data.map((item) =>
        new Date(CNDateToDateString(item.date?.split("-")[0] ?? item.date) || Date.now()).getTime()
      ),
      Date.now()
    )
  );
  const latestDate = new Date(
    Math.max(
      ...data.map((item) =>
        new Date(CNDateToDateString(item.date?.split("-")[1] ?? item.date) || Date.now()).getTime()
      ),
      new Date(new Date().toDateString()).getTime()
    )
  );
  const [items, setItems] = useState(data);

  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);

  const datesmountedRef = useRef(false);
  const [shouldTodayScrollIntoView, setShouldTodayScrollIntoView] = useState(false);

  useEffect(() => {
    const dateDiff = Math.ceil((latestDate.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));
    const dateLength = dateDiff + 1 < 30 ? 30 : dateDiff + 1;
    const dateArray = Array.from({ length: dateLength }, (_, i) => {
      const date = new Date(earliestDate);
      date.setDate(earliestDate.getDate() + i);
      return date.toISOString().split("T")[0];
    });
    setDates(dateArray);
    if (!datesmountedRef.current) {
      datesmountedRef.current = true;
      setShouldTodayScrollIntoView(true);
    }
  }, [data.length, earliestDate.getTime(), latestDate.getTime()]);

  useEffect(() => {
    if (shouldTodayScrollIntoView) {
      // 滚动到今日
      const todayElem = document.getElementById("today");
      if (todayElem) {
        todayElem.scrollIntoView({ behavior: "smooth", inline: "start" });
      } else {
        console.error("Today's element not found.");
      }
      sleep(800).then(() => {
        // 滚动到底部
        document.getElementById("heartexpress-timeline")?.scrollBy({
          top: 999999,
          behavior: "smooth",
        });
      });
      setShouldTodayScrollIntoView(false);
    }
  }, [shouldTodayScrollIntoView]);

  return (
    <>
      <div
        className="heartexpress-timeline"
        id="heartexpress-timeline"
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "0rem 0 1rem 0",
          overflow: "auto",
          position: "relative",
          height: "100%",
        }}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "left",
              alignItems: "center",
              padding: "0",
              fontSize: "12px",
              lineHeight: "24px",
              height: "25px",
              boxSizing: "border-box",
              marginBottom: "0.2rem",
              borderBottom: "1px solid #303030",
              width: "fit-content",
              zIndex: 2,
            }} // 日期轴
          >
            {dates.map((date, index) => (
              <div
                key={index}
                className={classNames("date-item", selectedDate === date ? "selected" : "")}
                id={date === new Date().toISOString().split("T")[0] ? "today" : ""}
                onClick={() => setSelectedDate(date)}
              >
                {Number(date.split("-")[2])}
              </div>
            ))}
          </div>
          {/** 轴线 */}
          {dates.map((date, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                top: "0",
                left: `${(index + 1) * 40 - 19}px`,
                height: `${(items.length + 1) * 28}px`,
                width: "1px",
                backgroundColor: selectedDate === date ? "red" : "#f0f0f0",
                transition: "background-color 0.15s",
                zIndex: 1,
              }}
            />
          ))}
        </>
        <div style={{ zIndex: 2 }}>
          {items.map((item) => (
            <BookingItem key={item.id} {...item} earliestDate={earliestDate} />
          ))}
        </div>
      </div>
      <BookingDetailDialog />
      <ZongheFenxiDialog />
      <OverviewDialog />
      <FloatButton.Group trigger="hover" type="primary" style={{ insetInlineEnd: 94 }} icon={<ToolOutlined />}>
        <FloatButton
          type="primary"
          icon={<FileAddOutlined />}
          tooltip="添加订单"
          onClick={() => {
            emitter.emit({
              type: "OPEN_BOOKING_DETAIL_DIALOG_REQUEST",
              payload: {
                record: {},
                type: "ADD",
              },
            });
          }}
        >
          添加订单
        </FloatButton>
        <FloatButton
          type="primary"
          icon={<ScanOutlined />}
          tooltip="综合分析"
          onClick={() => {
            emitter.emit({
              type: "OPEN_ZONGHE_FENXI_DIALOG_REQUEST",
              payload: {},
            });
          }}
        >
          风险监测
        </FloatButton>
        <FloatButton
          type="primary"
          icon={<ScanOutlined />}
          tooltip="简要概览"
          onClick={() => {
            emitter.emit({
              type: "OPEN_OVERVIEW_DIALOG_REQUEST",
              payload: {},
            });
          }}
        >
          简要概览
        </FloatButton>
      </FloatButton.Group>
    </>
  );
}
