import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import useEmitter from "#/utils/useEmitter";
import BookingDetailDialog from "#/components/booking-detail-dialog";
import "./index.css";
import { FloatButton } from "antd";
import { FileAddOutlined } from "@ant-design/icons";
import useHomeStore from "#/views/home/store";
import { CNDateToDateString } from "#/utils";

interface ItemType {
  id: number;
  title: string;
  earliestDate?: Date;
  date: string;
}

const DraggableListNode = (props: ItemType) => {
  const emitter = useEmitter();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.id,
  });
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginBottom: 2,
  };

  const isDraggingRef = useRef(false);

  const start = props.date?.split("-")[0];
  const end = props.date?.split("-")[1] || start;

  return (
    <div
      style={style}
      ref={setNodeRef}
      {...attributes}
      {...{
        ...listeners,
        onPointerDown: (e) => {
          isDraggingRef.current = false;
          e.stopPropagation();
          listeners?.onPointerDown(e);
        },
        onPointerMove: () => {
          isDraggingRef.current = true;
        },
      }}
    >
      <div
        className="booking-item"
        style={{
          marginLeft: calculateMarginLeft(start),
          width: calculateWidth(start, end),
          overflow: "visible", // 设置溢出可见
          whiteSpace: "nowrap", // 设置不换行
        }}
        onPointerUp={(_e) => {
          if (!isDraggingRef.current) {
            emitter.emit({
              type: "OPEN_BOOKING_DETAIL_DIALOG_REQUEST",
              payload: {
                record: props,
                type: "EDIT",
              },
            });
          }
        }}
      >
        {props.title}
      </div>
    </div>
  );
};

export default function HeartExpressTimelineSortable() {
  const emitter = useEmitter();
  const { bookings } = useHomeStore();
  const data = bookings;
  const earliestDate = new Date(
    Math.min(...data.map((item) => new Date(CNDateToDateString(item.date?.split("-")[0]) || Date.now()).getTime()))
  );
  const latestDate = new Date(
    Math.max(...data.map((item) => new Date(CNDateToDateString(item.date?.split("-")[1]) || Date.now()).getTime()))
  );
  const [items, setItems] = useState(data);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    // console.log(active);
    // console.log(over);
    if (active.id !== over?.id) {
      console.log("active", active.id);
      const activeIndex = items.findIndex((i) => i.id === active.id);
      const overIndex = items.findIndex((i) => i.id === over?.id);
      const newlist = arrayMove(items, activeIndex, overIndex);
      setItems(newlist);
    }
  };

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
      setShouldTodayScrollIntoView(false);
    }
  }, [shouldTodayScrollIntoView]);

  return (
    <>
      <div
        className="heartexpress-timeline"
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
          <DndContext modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                <DraggableListNode key={item.id} {...item} earliestDate={earliestDate} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>
      <BookingDetailDialog />
      <FloatButton
        type="primary"
        icon={<FileAddOutlined />}
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
    </>
  );
}
