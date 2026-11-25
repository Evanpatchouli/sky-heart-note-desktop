# 俱乐部共享订单 API

共享送心订单与俱乐部成员关系保存在服务端使用的 MongoDB 中。团员端的个人预约和送心号仍使用各团员自己的 SQLite 库。业务场景见[俱乐部业务说明](club-business.md)和[送心细则](heart-delivery.md)。

新单按赠送次数订购，报价记录段次数、日量和每次单价。建单预计实收单列爱心颗数。首次派发冻结每次抽成，续段沿用首段派抽和团抽。[正式业务口径](heart-delivery.md#订单分段)

正式报价折扣由本单派单人承担，优惠可超过本单派抽，无需先行补足。P1-12 按原单价和抽成核算送心报酬及团抽，分列派抽原额、整笔折扣支出和派单人个人净变动，分配合计与折后实付核平。P1-17 在本单派单人确认结单后记录派抽收入和折扣支出，超出部分由其已有余额承担，余额可记为负数，净变动仅作汇总。现阶段协议只记录下单和查询等已交付行为。[折扣算例](heart-delivery.md#100-次优惠-5-元如何对账)

正式业务允许买赠与报价折扣同时使用。优惠只从原付费服务款扣除，由本单派单人承担。促销赠送次数计入履约总量，在本单全部付费次数送完后履约。赠心成本由团费承担，两笔支出分列。买赠履约顺序、叠加报价与结算流程待按 P1-12 接入。[叠加算例](heart-delivery.md#买-100-送-5-再优惠-5-元如何对账)

正式按次退款待按 P1-14 接入。提前退单保留已履约明细，只按未送的付费次数核算应退爱心款，剩余促销赠送次数的退款金额为零。折扣单部分退款的金额分配待 Q2 确认。[提前退单算例](heart-delivery.md#活动与异常如何处理)

## 初始化俱乐部

先启动服务并准备平台账号。具有服务端数据库访问权的部署人员可运行以下命令。俱乐部标识由 1 至 32 位小写字母、数字及中间的连字符组成。`00A1` 和 `00B2` 是已有且拥有团员端准入的四位账号示例。

```powershell
pnpm --dir server build
pnpm --dir server exec node dist/src/commands/club.js club sky-hearts "送心俱乐部"
pnpm --dir server exec node dist/src/commands/club.js member sky-hearts 00A1 active dispatcher
pnpm --dir server exec node dist/src/commands/club.js member sky-hearts 00B2 active member
```

Docker 部署在仓库根目录使用 `docker compose exec server node dist/src/commands/club.js`，后接相同参数。重复使用同一俱乐部标识和四位账号会更新既有成员记录。用 `inactive` 停用成员会撤销团员侧订单访问并清空该成员在本俱乐部的管理权限，同时保留历史归属。重新启用成员后需逐项重新授权。`dispatcher` 标记用于客户下单的派单候选。有效成员均可发起自己的直接派单草稿。

正式归属规则由 P1-24 验收。老板主动指定与系统随机指定均限本俱乐部有效且带“派单”标记的团员。无合格候选时，创建待分配客户订单，由本俱乐部团长或副团长手动分配给任一有效团员，候选列表将有效且带“派单”标记者置顶。手动分配只记本单归属并保留成员原标记，仍由本单派单人主动派发。老板可在实际分配前取消本人的待分配订单。并发取消与手动分配只允许一项生效，重试返回本次操作的已保存结果，建单重试取回原单且不重新选人。各分支保留客户归属和“客户端下单”来源，确定派单人后记录归属方式。[正式归属规则](club-business.md#订单来源)

## 管理端俱乐部授权

管理操作需要当前管理端会话、在目标俱乐部的有效成员身份，以及针对该操作的俱乐部权限。部署人员通过同一运维命令逐项授予或撤销权限。以下示例中的 `00C3` 代表具有管理端准入的本俱乐部有效成员。

```powershell
pnpm --dir server exec node dist/src/commands/club.js grant sky-hearts 00C3 CLUB_ORDERS_READ
pnpm --dir server exec node dist/src/commands/club.js revoke sky-hearts 00C3 CLUB_ORDERS_READ
```

| 权限码 | 业务范围 |
| --- | --- |
| `CLUB_ORDERS_READ` | 查看指定俱乐部的订单监管视图 |
| `CLUB_MEMBERS_MANAGE` | 查看指定俱乐部的成员名单，编辑有效成员的派单标记 |
| `CLUB_COMMISSION_MANAGE` | 修改指定俱乐部每次团抽规则 |
| `CLUB_FINANCE_READ` | 读取指定俱乐部的资金明细，由财务接口接入 |

现有会话在下次请求时按当前数据检查权限。成员授权和启停继续由运维命令处理。管理端通过 `GET /api/admin/clubs` 读取本账号已获业务授权的俱乐部及各俱乐部的权限码。运营订单视图只返回订单和份额信息。团抽与财务服务的接入点是 `ClubDirectoryService.requireAdminPermission`，传入管理端会话、目标俱乐部标识和对应权限码。服务在准入、当前成员状态或单项权限不满足时返回 403。测试用已登录账号和同一测试数据库验证授权及撤销。实际团抽修改与资金查询随对应任务接入。[开发任务](todo.md)

## 写入与查询

| 方法 | 路由 | 可执行的操作 |
| --- | --- | --- |
| `GET` | `/api/employee/clubs/:clubId/order-customers?q=关键词` | 有效团员按用户名、昵称或四位 ID 搜索可进入客户端的启用账号，最多返回 20 条 `{ userId, nickname }`。完整 ID 优先，其次是完整用户名、昵称。 |
| `POST` | `/api/employee/clubs/:clubId/orders` | 有效团员新建直接派单草稿，选择已有用户或填写新老板昵称。创建人与本单派单人均为当前团员。 |
| `POST` | `/api/employee/clubs/:clubId/orders/:orderId/customer-activation` | 原建档订单的当单派单人生成客户端一次性激活链接，返回 `activationUrl` 和毫秒时间戳 `expiresAt`。 |
| `POST` | `/api/user/activate-dispatch-customer` | 客户端来源提交 JSON `{ token, username, password }`，为链接对应的原客户账号设置首次登录凭据。 |
| `POST` | `/api/client/clubs/:clubId/orders` | 登录客户提交本人订单。可填 `dispatcherUserId` 指定本俱乐部有派单标记且可进入团员端的有效成员，省略则在该范围内随机选人。订单创建时为待派发。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders` | 客户端查本人已核实归属的订单。团员端查本人负责派单、或已派发且本人承接的订单。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders/:orderId` | 按列表相同的归属范围查询详情。 |
| `GET` | `/api/client/orders` | 跨俱乐部查询归属本人的订单，使用相同的筛选和分页参数。 |
| `GET` | `/api/employee/clubs` | 读取当前团员的有效成员俱乐部。 |
| `GET` | `/api/admin/clubs/:clubId/orders` | 按俱乐部授权监管该俱乐部所有订单，返回业务状态、客户归属及份额分配。 |
| `GET` | `/api/admin/clubs/:clubId/orders/:orderId` | 在同一监管范围内查询指定订单。 |
| `GET` | `/api/admin/clubs/:clubId/members` | 查询指定俱乐部成员的昵称、四位 ID、成员状态和派单标记。 |
| `PATCH` | `/api/admin/clubs/:clubId/members/:userId/dispatcher` | 用 `{"dispatcher": true}` 或 `{"dispatcher": false}` 更新有效成员的派单标记。 |

下单需要相应端的访问令牌和 JSON 请求体。两个下单入口共用 `requestId`、`recipientGameAccount`、`requestedGiftTimes`，可另填 `estimatedReceivedHearts`。历史 `requestedHearts` 允许同一俱乐部、来源、创建人和标识原样重试已保存的请求。新单一律使用赠送次数。每次新建生成一个 UUID v4，请求重试时沿用相同的 `requestId` 与内容。相同提交标识配不同内容返回 HTTP 409。随机候选为空时返回 HTTP 409，订单未创建。显式指定当前候选范围之外的账号返回 HTTP 400。

以下请求体可用于客户端普通送心单。直接派单也使用三个共用必填字段。

```json
{
  "requestId": "a9fc2895-ff11-494a-9be7-5b3e5847b2ca",
  "recipientGameAccount": "接收爱心的游戏账号",
  "requestedGiftTimes": 100,
  "deliveryPeriodPreference": "normal"
}
```

两个建单入口都可填 `deliveryPeriodPreference`，取 `normal`、`double` 或 `split`。若未填写 `estimatedReceivedHearts`，普通期按赠送次数记预计颗数，双倍期按两倍记。混合时段可另填 `doubleGiftTimes`，为小于订购总次数的正整数，系统按总次数加双倍期次数估算。时段未填或混合数量未确认时可保留未知。建单预计一经保存，后续报价和登记实收沿用原值。

团员在「派单准备」点击「新建直接派单草稿」，选择「已有用户」并用昵称和四位 ID 核对搜索结果，或选择「新老板」填写 1 至 100 字昵称。请求传 `"existingCustomerUserId": "00A1"` 或 `"newCustomerNickname": "青禾"`。已选账号须处于启用状态且拥有客户端准入角色。新老板获得平台分配的独立四位 ID 与普通客户角色，同名时仍建独立账号。成功响应的 `customerUserId` 表示老板归属，`recipientGameAccount` 记录接收爱心的游戏账号。

新老板的原建档订单确认归属后，当前有效派单人可在「派单准备」点击「生成激活链接」，再点击「复制激活链接」交给这位老板。团员端列表只为符合条件的原建档订单返回 `customerActivationAvailable: true`。其他派单人可继续使用四位 ID 关联后续订单。已有登录凭据的账号不提供此激活动作。

链接指向 `CLIENT_ORIGIN` 的 `/activate`，令牌位于 URL 片段中。链接有效期为 24 小时，重新生成后上一条未使用的链接立即失效。服务端保存令牌摘要，原子写入密码哈希和使用时间。用户名已占用时可换名并继续使用同一个链接。成功后用新账号正常登录客户端，可查看原四位 ID 名下已确认归属的历史订单。若提交后未收到结果，重试显示已使用时可直接用刚设置的账号和密码登录。

P1-02 首次激活走查覆盖派单人从原单复制链接、老板刷新后自行设置凭据、原昵称与四位 ID 保留、多笔历史订单可查询。另验证重新签发、过期、重复提交、用户名冲突、账号或普通客户角色停用，以及同俱乐部其他派单人无权签发。

旧调用可仅传 `customerLabel` 或省略老板字段，订单归属为 `pending_verification`。称呼只供记录。提交多个归属字段会返回 HTTP 400。若新老板的建号或归属确认失败，沿用原请求标识及内容重试。草稿与新账号在归属确认后才进入派单订单列表和客户搜索。团员端会在当前标签页按当前账号和俱乐部保存待确认提交。关闭弹窗或刷新后，在同一俱乐部重新打开弹窗并点击「重试本次提交」。

客户端「我的订单」可以按「订单来源」筛选直接派单和客户端下单。接口支持 `source=direct_dispatch`、`source=client_order` 和 `limit`（默认 25，最多 100）、`after` 分页。成功响应的 `data.items` 是该页订单，存在下一页时把 `data.nextCursor` 传给 `after`。

派单人能查单内已建立的份额和客户平台归属状态。承接人可见履约用的接收游戏账号、本人份额及该份额的执行游戏账号。同单兼任派单和承接时，可同时查看派单信息和本人份额的执行账号。执行账号具有独立标识，名称是订单内显示快照。客户可查看订单来源、业务类型、接收游戏账号、数量和派发状态。直接派单须核实平台客户归属后才进入客户查单范围。

客户端「我的订单」可展开本人订单，核对建单预计实收爱心、各段单价与数量、爱心款、预估解锁款、报价合计和登记的实收金额与时间。直接派单和客户端下单使用同一报价及收款流程。

## 固定金额抽成与派单准备

管理端通过 `GET /api/admin/clubs/:clubId/commission-rule` 查当前规则，通过相同路径的 `PATCH` 更新。派单人通过 `GET /api/employee/clubs/:clubId/orders/:orderId/pricing` 查报价和规则，通过相同路径的 `PATCH` 保存报价。

管理端只填写每次团抽，派单人只填写每次服务单价与每次派抽。金额使用整数分。规则更新请求包含 `expectedVersion` 和 `clubFeeCents`，首次配置使用版本 `0`。报价更新请求包含 `ruleVersion`、`expectedRevision`（首次为 `0`）、`dispatchFeeCents` 和 `giftSegments`。两类请求可省略 `basis`，显式填写时仅接受 `gift_times`。已有按颗团抽须由具备本俱乐部权限的管理员填写新的每次金额后启用。规则或报价版本已变化时，服务返回 HTTP 409。

按次报价的 `priceUnit` 为 `gift_times`。每段含 `period`（`normal` 或 `double`）、`paidGiftTimes`（付费赠送次数）、`dailyGiftTimes`（日量）和 `unitPriceCents`（每次服务单价）。各段付费次数合计等于原订购次数。按付费次数乘每次单价计算报价。建单预计实收颗数单列，普通期和双倍期的同量同价订单具有相同爱心款。

报价请求可带 `unlock`，其中 `quantity` 为预估解锁数，`unitPriceCents` 为每次解锁费。首次未填时默认为零，编辑时省略沿用当前值。报价返回 `heartsAmountCents`、`unlockAmountCents` 和 `totalAmountCents`。解锁款为预估解锁数乘每次解锁费，总额为爱心款加解锁款。金额超出安全整数分范围时返回 HTTP 400。

首次正式派发时冻结每次派抽、每次团抽和规则版本。派单人可用 `POST /api/employee/clubs/:clubId/orders/:orderId/continuation-quotes` 追加独立报价。请求包含 UUID v4 `requestId` 和一个与报价段同结构的 `segment`。响应含续段爱心款和从首段快照读取的 `commission`。续段保存为待核款报价，重试同一标识及内容取回原报价。客户仅可查看本人订单及其报价；抽成仅在获授权的业务入口返回。

历史订单保留 `requestedHearts`、原报价和已派发快照。历史报价没有按次标记时，报价按原颗数和每颗单价展示。历史抽成按快照的 `basis` 和版本展示，即使同一笔旧单使用按次抽成，也继续按颗展示原报价。

派单人在「派单准备」保存报价后可登记本人实收。使用 `POST /api/employee/clubs/:clubId/orders/:orderId/receipts`，提交 `pricingRevision`、正整数分 `receivedAmountCents`、带时区的 `receivedAt` 和 UUID v4 `requestId`。服务记录收款人、经办人、两次时间和完整原报价。同一标识与内容可原样重试。报价修改与实收登记同时提交时，只有先写入的请求生效，另一个返回 HTTP 409。实收有差额时保留登记和原报价，订单继续待核款。

后台规则更新后，可通过 `PATCH /api/employee/clubs/:clubId/orders/:orderId/dispatch-commission` 提交 `pricingRevision`、`expectedReviewRevision`（首次为 `0`）、`ruleVersion` 和 `dispatchFeeCents`，复核每次派抽。

实收等于原报价合计且规则仍有效时，派单人可用 `POST /api/employee/clubs/:clubId/orders/:orderId/publish` 正式派发。请求含 UUID v4 `requestId`、`pricingRevision`、`ruleVersion` 和 `commissionReviewRevision`（未复核填 `0`）。相同标识及内容可重试。服务原子写入正式派发时间与首段快照。承接及绑定个人送心号随对应任务接入，待分配、手动分配与分配前取消按 P1-24 验收。[正式归属规则](club-business.md#订单来源)
