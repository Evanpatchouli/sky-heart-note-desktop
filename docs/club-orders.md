# 俱乐部共享订单 API

共享送心订单与俱乐部成员关系保存在服务端使用的 MongoDB 中。团员端的个人预约和送心号仍使用各团员自己的 SQLite 库。业务场景见[俱乐部业务说明](club-business.md)和[送心细则](heart-delivery.md)。

## 初始化俱乐部

先启动服务并准备平台账号。具有服务端数据库访问权的部署人员可运行以下命令。俱乐部标识由 1 至 32 位小写字母、数字及中间的连字符组成。`00A1` 和 `00B2` 是已有且拥有团员端准入的四位账号示例。

```powershell
pnpm --dir server build
pnpm --dir server exec node dist/src/commands/club.js club sky-hearts "送心俱乐部"
pnpm --dir server exec node dist/src/commands/club.js member sky-hearts 00A1 active dispatcher
pnpm --dir server exec node dist/src/commands/club.js member sky-hearts 00B2 active member
```

Docker 部署在仓库根目录使用 `docker compose exec server node dist/src/commands/club.js`，后接相同参数。重复使用同一俱乐部标识和四位账号会更新既有成员记录。用 `inactive` 停用成员可撤销团员侧订单访问，同时保留历史归属。`dispatcher` 标记用于客户下单的派单候选。有效成员均可发起自己的直接派单草稿。

这组命令用于运维初始化。管理端的成员和标记维护入口随 P1-01、P1-04 的俱乐部授权落实。[开发任务](todo.md)

## 写入与查询

| 方法 | 路由 | 可执行的操作 |
| --- | --- | --- |
| `GET` | `/api/employee/clubs/:clubId/order-customers?q=关键词` | 有效团员按用户名、昵称或四位 ID 搜索可进入客户端的启用账号，最多返回 20 条 `{ userId, nickname }`。完整 ID 优先，其次是完整用户名、昵称。 |
| `POST` | `/api/employee/clubs/:clubId/orders` | 有效团员新建直接派单草稿，选择已有用户或填写新老板昵称。创建人与本单派单人均为当前团员。 |
| `POST` | `/api/client/clubs/:clubId/orders` | 登录客户提交本人订单。可填 `dispatcherUserId` 指定本俱乐部有派单标记且可进入团员端的有效成员，省略则在该范围内随机选人。订单创建时为待派发。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders` | 客户端查本人已核实归属的订单。团员端查本人负责派单、或已派发且本人承接的订单。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders/:orderId` | 按列表相同的归属范围查询详情。 |
| `GET` | `/api/client/orders` | 跨俱乐部查询归属本人的订单，使用相同的筛选和分页参数。 |
| `GET` | `/api/employee/clubs` | 读取当前团员的有效成员俱乐部。 |

写入需要相应端的访问令牌和 JSON 请求体。两个入口共用 `requestId`、`recipientGameAccount`、`requestedHearts`。每次新建生成一个 UUID v4，请求重试时沿用相同的 `requestId` 与内容。同一俱乐部、来源和创建人的重复提交返回已保存的订单，相同提交标识配不同内容返回 HTTP 409。候选为空同样返回 HTTP 409，订单无法创建。显式指定当前候选范围之外的账号返回 HTTP 400。

以下请求体可用于客户端普通送心单。直接派单也使用 `requestId`、`recipientGameAccount`、`requestedHearts` 三个共用字段。

```json
{
  "requestId": "a9fc2895-ff11-494a-9be7-5b3e5847b2ca",
  "recipientGameAccount": "接收爱心的游戏账号",
  "requestedHearts": 100
}
```

团员在「派单准备」点击「新建直接派单草稿」，选择「已有用户」并用昵称和四位 ID 核对搜索结果，或选择「新老板」填写 1 至 100 字昵称。请求传 `"existingCustomerUserId": "00A1"` 或 `"newCustomerNickname": "青禾"`。已选账号须处于启用状态且拥有客户端准入角色。新老板获得平台分配的独立四位 ID 与普通客户角色，同名时仍建独立账号。成功响应的 `customerUserId` 表示老板归属，`recipientGameAccount` 记录接收爱心的游戏账号。新老板登录凭据交接待 Q6 确认。[待确认规则](heart-delivery.md#需要业务方确认的决定)

旧调用可仅传 `customerLabel` 或省略老板字段，订单归属为 `pending_verification`。称呼只供记录。提交多个归属字段会返回 HTTP 400。若新老板的建号或归属确认失败，沿用原请求标识及内容重试。草稿与新账号在归属确认后才进入派单订单列表和客户搜索。团员端会在当前标签页按当前账号和俱乐部保存待确认提交。关闭弹窗或刷新后，在同一俱乐部重新打开弹窗并点击「重试本次提交」。

客户端「我的订单」可以按「订单来源」筛选直接派单和客户端下单。接口支持 `source=direct_dispatch`、`source=client_order` 和 `limit`（默认 25，最多 100）、`after` 分页。成功响应的 `data.items` 是该页订单，存在下一页时把 `data.nextCursor` 传给 `after`。

派单人能查单内已建立的份额和客户平台归属状态。承接人可见履约用的接收游戏账号与本人份额，并可查该份额内的执行游戏账号。执行账号具有独立标识，名称是订单内显示快照。客户可查看订单来源、业务类型、接收游戏账号、数量和派发状态。直接派单须核实平台客户归属后才进入客户查单范围。

本阶段提供草稿、客户提交和订单查询。实际发布、承接、绑定个人送心号及 Q7 候选范围例外处理随对应业务流程接入。[待确认规则](heart-delivery.md#需要业务方确认的决定)
