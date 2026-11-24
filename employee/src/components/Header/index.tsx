import { Col, Row, Segmented } from "antd";
import { AppstoreOutlined, BarsOutlined, TableOutlined, CalendarOutlined } from "@ant-design/icons";
import Timenow from "./timenow";
import TimelineOutlined from "../icons/TimelineOutlined";
import { useSearchParams } from "react-router";

export default function Header() {
  const [params, setParams] = useSearchParams();
  return <header className="App-header"><Row align="middle" justify="space-between">
    <Col style={{ maxWidth: "100%", overflowX: "auto" }}>
      <Segmented value={params.get("vtype") || "timeline"} onChange={value => {
        setParams(previous => { previous.set("vtype", value); return previous; });
      }} options={[
        { label: "时间轴", value: "timeline", icon: <TimelineOutlined /> },
        { label: "列表", value: "list", icon: <BarsOutlined /> },
        { label: "日历", value: "calendar", icon: <CalendarOutlined /> },
        { label: "表格", value: "datagrid", icon: <TableOutlined /> },
        { label: "看板", value: "kanban", icon: <AppstoreOutlined /> },
      ]} />
    </Col>
    <Col><Timenow /></Col>
  </Row></header>;
}
