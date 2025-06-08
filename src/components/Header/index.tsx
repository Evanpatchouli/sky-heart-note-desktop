import { Segmented } from "antd";
import { AppstoreOutlined, BarsOutlined, TableOutlined, CalendarOutlined } from "@ant-design/icons";
import type { CountdownProps } from "antd";
import { Col, Row, Statistic } from "antd";
import Timenow from "./timenow";
import TimelineOutlined from "../icons/TimelineOutlined";
import { useLoaderData, useSearchParams } from "react-router";

const onFinish: CountdownProps["onFinish"] = () => {
  console.log("finished!");
};

const onChange: CountdownProps["onChange"] = (val) => {
  if (typeof val === "number" && 4.95 * 1000 < val && val < 5 * 1000) {
    console.log("changed!");
  }
};

export default function Header() {
  const [, setSearchParams] = useSearchParams();
  const { vtype } = useLoaderData();

  return (
    <header className="App-header">
      <Row align="middle" justify="space-between">
        <Col>
          <Segmented
            value={vtype || "timeline"}
            onChange={(val) => {
              setSearchParams((prev) => ({ ...prev, vtype: val }));
            }}
            options={[
              { label: "时间轴", value: "timeline", icon: <TimelineOutlined /> },
              { label: "列表", value: "list", icon: <BarsOutlined /> },
              { label: "日历", value: "calendar", icon: <CalendarOutlined /> },
              { label: "表格", value: "datagrid", icon: <TableOutlined /> },
              { label: "看板", value: "kanban", icon: <AppstoreOutlined /> },
            ]}
          />
        </Col>
        <Col>
          <Timenow />
        </Col>
      </Row>
    </header>
  );
}
