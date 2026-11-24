import { FloatButton } from "antd";
import { FileAddOutlined, PieChartOutlined, ToolOutlined, EyeOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router";
import BookingDetailDialog from "#/components/booking-detail-dialog";
import { ZongheFenxiDialog } from "#/components/zonghe-fenxi-dialog";
import OverviewDialog from "#/components/overview-dialog";
import useEmitter from "#/utils/useEmitter";
import HeartExpressTimeline from "../templates/heart-express-timeline";
import HeartExpressDataGrid from "../templates/heart-express-datagrid";
import HeartExpressList from "../templates/heart-express-list";
import HeartExpressKanban from "../templates/heart-express-kanban";

export default function Home() {
  const [params] = useSearchParams();
  const emitter = useEmitter();
  switch (params.get("vtype")) {
    case "datagrid": return <HeartExpressDataGrid />;
    case "list": return <HeartExpressList />;
    case "kanban": return <HeartExpressKanban />;
  }
  return <>
    <HeartExpressTimeline />
    <BookingDetailDialog />
    <OverviewDialog />
    <ZongheFenxiDialog />
    <FloatButton.Group trigger="click" type="primary" icon={<ToolOutlined />} aria-label="订单操作">
      <FloatButton tooltip="添加订单" aria-label="添加订单" icon={<FileAddOutlined />} onClick={() => emitter.emit({ type: "OPEN_BOOKING_DETAIL_DIALOG_REQUEST", payload: { type: "ADD" } })} />
      <FloatButton tooltip="综合分析" aria-label="综合分析" icon={<PieChartOutlined />} onClick={() => emitter.emit({ type: "OPEN_ZONGHE_FENXI_DIALOG_REQUEST", payload: {} })} />
      <FloatButton tooltip="简要概览" aria-label="简要概览" icon={<EyeOutlined />} onClick={() => emitter.emit({ type: "OPEN_OVERVIEW_DIALOG_REQUEST", payload: {} })} />
    </FloatButton.Group>
  </>;
}
