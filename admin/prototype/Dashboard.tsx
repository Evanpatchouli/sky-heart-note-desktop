import { Button, Card, Col, Descriptions, Empty, Flex, Grid, Progress, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { Link } from "react-router";
import { money, useClub, type Order } from "./club";
import { availableHearts, inQueue, ordersUrl, statusColors, statusOf, type Queue } from "./order-overview";
import { reconcile, useSettlements } from "./settlement-book";

const sources: Order["source"][] = ["直接派单", "客户端下单"];

export default function Dashboard() {
  const { orders } = useClub();
  const { posted, pending } = useSettlements();
  const narrow = !Grid.useBreakpoint().md;
  useEffect(() => { document.title = "俱乐部运营仪表盘 - 送心手记"; }, []);

  const metrics: {key: Queue; label: string; value: number; unit: string}[] = [
    {key:"pending", label:"待派单订单", value:orders.filter(o=>inQueue(o,"pending")).length, unit:"笔"},
    {key:"available", label:"待承接份额", value:orders.reduce((n,o)=>n+availableHearts(o),0), unit:"颗"},
    {key:"delivered", label:"累计实际到账", value:orders.reduce((n,o)=>n+o.delivered,0), unit:"颗"},
    {key:"changes", label:"改价与退款待办", value:orders.filter(o=>inQueue(o,"changes")).length, unit:"笔"},
  ];
  const tasks = orders.filter(o => inQueue(o,"pending") || inQueue(o,"changes"));
  const pendingAmount = pending.reduce((sum,s) => sum + reconcile(s).receipt, 0);
  const postedClubNet = posted.reduce((sum,s) => sum + reconcile(s).clubNet, 0);

  return <section className="review-page club-dashboard">
    <Flex align="baseline" justify="space-between" gap={8} wrap>
      <Typography.Title level={4}>俱乐部运营仪表盘</Typography.Title>
      <Typography.Text type="secondary">送心业务 · 全部订单</Typography.Text>
    </Flex>
    <Row gutter={[12,12]}>
      {metrics.map(m => <Col key={m.key} xs={12} xl={6}>
        <Link className="dashboard-metric" to={ordersUrl({queue:m.key})} aria-label={`${m.label} ${m.value} ${m.unit}，查看订单`}>
          <Card size="small" hoverable>
            <Statistic title={m.label} value={m.value} suffix={<small>{m.unit}</small>}/>
            <RightOutlined className="dashboard-go" />
          </Card>
        </Link>
      </Col>)}
    </Row>
    <Card title="派单与履约待办" size="small" extra={<Link to={ordersUrl()}>订单监管</Link>}>
      <Table<Order> rowKey="id" size="small" dataSource={tasks} pagination={tasks.length > 5 ? {pageSize:5,showSizeChanger:false} : false}
        locale={{emptyText:"当前没有待派单或待处理的变更"}} columns={[
          {title:"订单",render:(_,o)=><Space orientation="vertical" size={2}><Typography.Text strong>{o.title}</Typography.Text>
            <Typography.Text type="secondary">{o.id}</Typography.Text>
            {narrow && <Typography.Text type="secondary">{o.dispatcher} · {statusOf(o)}</Typography.Text>}</Space>},
          ...(!narrow ? [
            {title:"派单人",dataIndex:"dispatcher"},
            {title:"当前进度",render:(_:unknown,o:Order)=>`${o.delivered} / ${o.total} 颗`},
            {title:"待办状态",render:(_:unknown,o:Order)=><Tag color={statusColors[statusOf(o)]}>{statusOf(o)}</Tag>},
          ] : []),
          {title:"操作",width:74,render:(_,o)=><Link to={ordersUrl({order:o.id})} aria-label={`查看待办 ${o.id}`}>详情</Link>},
        ]}/>
    </Card>
    <Row gutter={[12,12]}>
      <Col xs={24} lg={12}>
        <Card title="订单来源与交付" size="small">
          <Space orientation="vertical" size="middle" style={{width:"100%"}}>
            {sources.map(source=>{
              const matches = orders.filter(o=>o.source===source);
              const arrived = matches.reduce((n,o)=>n+o.delivered,0), total=matches.reduce((n,o)=>n+o.total,0);
              return <div key={source}>
                <Flex justify="space-between" gap={8} align="center">
                  <Link to={ordersUrl({source})}>{source}</Link>
                  <Typography.Text type="secondary">{matches.length} 笔</Typography.Text>
                </Flex>
                <Progress size="small" percent={total ? Math.round(arrived*100/total) : 0} showInfo={false}/>
                <Typography.Text type="secondary">到账 {arrived} / 订购 {total} 颗</Typography.Text>
              </div>;
            })}
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="结算核对" size="small" extra={<Link to="/club/finance">财务对账</Link>}>
          <Descriptions size="small" column={1} items={[
            {key:"pending",label:"待入账样单",children:`${pending.length} 笔 · ${money(pendingAmount)}`},
            {key:"posted",label:"已入账团费净额",children:money(postedClubNet)},
          ]}/>
          {pending.length ? <ul className="dashboard-settlements">
            {pending.map(s=><li key={s.id}><span>{s.title}</span>
              <Link to={"/club/finance?settlement="+encodeURIComponent(s.id)} aria-label={"核对 "+s.id}>核对 {money(reconcile(s).receipt)}</Link>
            </li>)}
          </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="结算样单均已入账">
            <Button href="#/club/finance">查看入账结果</Button></Empty>}
        </Card>
      </Col>
    </Row>
  </section>;
}
