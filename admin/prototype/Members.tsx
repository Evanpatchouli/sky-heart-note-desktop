import { useState } from "react";
import { App, Button, Flex, Form, Grid, Input, Modal, Radio, Select, Table, Tag, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { TableColumnsType } from "antd";
import { setDispatcher, useClub } from "./club";

type Filter = "all" | "marked" | "unmarked";
type MemberRow = {
  name: string;
  dispatcher: boolean;
  dispatchCount: number;
  claimCount: number;
};

export default function Members() {
  const { members, orders } = useClub();
  const { message } = App.useApp();
  const { md } = Grid.useBreakpoint();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [page, setPage] = useState(1);

  const rows: MemberRow[] = members.map(member => ({
    name: member.name,
    dispatcher: member.dispatcher,
    dispatchCount: orders.filter(order => order.dispatcher === member.name).length,
    claimCount: orders.filter(order => order.claims.some(claim => claim.name === member.name)).length,
  }));
  const visible = rows.filter(row => row.name.includes(search.trim()) &&
    (filter === "all" || row.dispatcher === (filter === "marked")));
  const current = members.find(member => member.name === editing);

  function edit(row: MemberRow) {
    setMarked(row.dispatcher);
    setEditing(row.name);
  }

  function save() {
    if (!current) return;
    try {
      setDispatcher(current.name, marked);
      setEditing(null);
      setPage(1);
      void message.success("派单标记已更新");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "保存失败，请重试");
    }
  }

  const columns: TableColumnsType<MemberRow> = [
    { title: "团员昵称", dataIndex: "name" },
    {
      title: "派单标记", dataIndex: "dispatcher",
      render: (enabled: boolean) => enabled ? <Tag color="blue">派单</Tag> : <Typography.Text type="secondary">未标记</Typography.Text>,
    },
    {
      title: "负责派单", dataIndex: "dispatchCount", align: "right", responsive: ["md"],
      sorter: (a, b) => a.dispatchCount - b.dispatchCount,
      render: (count: number) => `${count} 笔`,
    },
    {
      title: "参与承接", dataIndex: "claimCount", align: "right", responsive: ["md"],
      sorter: (a, b) => a.claimCount - b.claimCount,
      render: (count: number) => `${count} 笔`,
    },
    {
      title: "操作", key: "action", width: 110,
      render: (_, row) => <Button onClick={() => edit(row)}>编辑标记</Button>,
    },
  ];

  return (
    <section className="review-page" aria-label="团员管理">
      <Typography.Title level={4}>团员管理</Typography.Title>
      <Flex className="review-toolbar" wrap gap="small">
        <Input value={search} allowClear prefix={<SearchOutlined />} aria-label="搜索团员昵称" placeholder="搜索团员昵称"
          style={{ width: 190, maxWidth: "100%" }}
          onChange={event => { setSearch(event.target.value); setPage(1); }} />
        <Select<Filter> aria-label="筛选派单标记" value={filter} style={{ width: 150 }}
          options={[{ value: "all", label: "全部派单标记" }, { value: "marked", label: "已标记派单" }, { value: "unmarked", label: "未标记" }]}
          onChange={value => { setFilter(value); setPage(1); }} />
      </Flex>
      <Table<MemberRow> rowKey="name" columns={columns} dataSource={visible}
        locale={{ emptyText: "没有符合条件的团员" }}
        expandable={md ? undefined : {
          columnWidth: 32,
          expandedRowRender: row => <Flex wrap gap="middle">
            <Typography.Text>负责派单 {row.dispatchCount} 笔</Typography.Text>
            <Typography.Text>参与承接 {row.claimCount} 笔</Typography.Text>
          </Flex>,
        }}
        pagination={{ current: page, pageSize: 10, onChange: setPage, showSizeChanger: false, showTotal: total => `共 ${total} 名团员` }} />
      <Modal title="编辑派单标记" open={editing !== null} width={460}
        onCancel={() => setEditing(null)} onOk={save} okText="确认保存" cancelText="取消"
        okButtonProps={{ disabled: !current || current.dispatcher === marked }}>
        <Form layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item label="团员昵称"><Typography.Text strong>{editing}</Typography.Text></Form.Item>
          <Form.Item label="派单标记" extra="老板未指定派单人时，系统从已标记团员中随机选择一位。所有团员都可以直接派单和接单。">
            <Radio.Group aria-label="派单标记" value={marked} onChange={event => setMarked(event.target.value)}>
              <Radio value={true}>标记为派单人</Radio>
              <Radio value={false}>不标记</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
