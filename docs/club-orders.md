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
pnpm --dir server exec node dist/src/commands/club.js position sky-hearts 00B2 leader
```

Docker 部署在仓库根目录使用 `docker compose exec server node dist/src/commands/club.js`，后接相同参数。重复使用同一俱乐部标识和四位账号会更新既有成员记录。用 `inactive` 停用成员会撤销团员侧订单访问并清空该成员在本俱乐部的管理权限，同时保留历史归属。重新启用成员后需逐项重新授权。`dispatcher` 标记用于客户下单的派单候选。有效成员均可发起自己的直接派单草稿。

部署人员用 `position <俱乐部标识> <四位用户ID> <leader|deputy|member>` 设置团长、副团长或普通团员。既有成员未设置时按普通团员处理，停用成员会清除领导职务。俱乐部职务与派单标记、管理端及财务权限分别配置。

老板主动指定与系统随机指定均限本俱乐部有效且带“派单”标记的团员。无候选时创建待分配订单，之后新增候选不会改变原订单。团长或副团长从团员端「派单准备 → 待分配订单」选择任一有团员端准入的本俱乐部有效成员，带“派单”标记者优先显示。手工分配只确定本单派单人。分配前老板可在本人订单详情取消。

取消与分配同时提交时只有一项生效。建单重试取回原单，不重新选人。取消及分配重试取回原决定，即使订单已进入下一阶段。在当前标签页未收到分配回执时，「待分配订单」保留「重试本次分配」入口。订单记录客户端来源、客户、原建单请求和归属方式，手工决定另外记录操作人、时间与请求标识。分配后仍由当单派单人在「派单准备」核款并主动派发。[正式归属规则](club-business.md#订单来源)

## 客户端下单入口

团员在「派单准备」选择俱乐部后，可以复制「客户端下单链接」，例如 `https://client.example.com/order?club=sky-hearts`。链接使用服务端配置的 `CLIENT_ORIGIN`。老板登录后填写接收游戏账号、赠送次数，可另填期望交付时段与预计实收爱心颗数。提交后可查看订单详情，该详情也提供「向此俱乐部下单」。在当前标签页刷新后，「下单」沿用当前账号上次打开的俱乐部。单俱乐部部署可在 Vite 环境配置 `VITE_CLIENT_ORDER_CLUB_ID`。

没有合格候选时，老板可以提交待分配订单。网络结果不明时，客户端在当前浏览器标签页按客户账号与俱乐部保留原请求，点击「重试本次提交」可取回已创建的订单。

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

## 按次派发、承接和注册邀请

在团员端的「派单准备」核对已付报价，选择「正式派发」，为每段填写执行日期。每段可保留公开份额，也可为本团有效团员填写每日负责次数和各自的预期窗口。仅定向时须覆盖该段全部次数。通过旧版接口已核款并正式派发的按次订单，由原派单人在「按次派发与分工」补配。原派发状态、抽成和收款继续沿用。兼容补配沿用原派发记录。

「按次接单」只列已派发且有公开份额或本人份额的订单。团员可填每日能赠送的次数，系统按领取顺序和逐日余量发放，预留的定向份额由受邀团员主动确认。每段只可领取一次公开份额。即使是本单派单人，也可领取公开份额或确认指定给自己的份额。双倍期预计到账、接单时实收爱心及现金实收分别记录。接单实收可留空，`0` 颗表示已记录为零。

本单派单人可把尚未送出的次数全部或部分改派给本团另一位有效团员，接手人确认后获得该段的相应份额。已送次数按同一份额的最新日报版本核对，原日报和人员归属保留。改派网络结果不明时，可在原订单重试同一次请求。

在「派单准备」选择俱乐部后可生成本团注册邀请。链接有效期为 24 小时，仅限创建一个新账号，直接进入该俱乐部的普通团员身份。新团员设置登录凭据并入团后可在团员端登录，派单人刷新选人列表后可选到该账号。

| 方法 | 挂在 `/api` 下的路由 | 操作 |
| --- | --- | --- |
| `POST` | `/employee/clubs/:clubId/orders/:orderId/publish` | 原发布字段可附带 `giftDispatchSegments`，每项含 `segmentIndex`、`startDate`、`endDate`、`openToClaim` 和 `directed`。定向项含 `userId`、`dailyGiftTimes`、`startDate`、`endDate`。 |
| `GET`、`POST` | `/employee/clubs/:clubId/orders/:orderId/gift-dispatch` | 当单派单人读分工或补配未配置的已付段。补配提交 `{ requestId, segments }`，每项与正式派发分工的结构相同。 |
| `GET` | `/employee/clubs/:clubId/gift-claims`、`/employee/clubs/:clubId/gift-claims/:orderId` | 读取当前团员可见的按次派单。定向份额和已领取详情按身份裁剪，执行日期相连且日量相同的记录合并显示。 |
| `POST` | `/employee/clubs/:clubId/gift-claims/:orderId` | 公开提交 `{ requestId, segmentIndex, kind: "public", dailyGiftTimes }`。定向提交 `{ requestId, segmentIndex, kind: "directed", offerId }`。两种承接均可传 `actualReceivedHearts`。回执包含获分 `giftTimes` 和 `dailyGiftTimes`。正份额另有 `shareId`。 |
| `POST` | `/employee/clubs/:clubId/orders/:orderId/gift-dispatch/reassign` | 提交 `{ requestId, shareId, userId, giftTimes? }`。省略次数时改派全部未送次数，返回给新团员的待确认定向份额。 |
| `GET` | `/employee/clubs/:clubId/gift-candidates` | 查询团内当前可接单的有效成员。 |
| `POST` | `/employee/clubs/:clubId/member-invitations` | 有效团员取得本团一次性注册链接和截止时间。 |
| `POST` | `/client/club-invitations/register` | 通过客户端来源提交 `{ token, username, password }`，完成新团员入团。 |

段序号从 0 开始，执行日期为 `YYYY-MM-DD`，窗口包含首尾日。请求标识用 UUID v4。新增续段仍须先核款，待核款的续段报价不会进入可接单列表。历史按颗订单沿用既有数量、金额及已发记录。

## 写入与查询

| 方法 | 路由 | 可执行的操作 |
| --- | --- | --- |
| `GET` | `/api/employee/clubs/:clubId/order-customers?q=关键词` | 有效团员按用户名、昵称或四位 ID 搜索可进入客户端的启用账号，最多返回 20 条 `{ userId, nickname }`。完整 ID 优先，其次是完整用户名、昵称。 |
| `POST` | `/api/employee/clubs/:clubId/orders` | 有效团员新建直接派单草稿，选择已有用户或填写新老板昵称。创建人与本单派单人均为当前团员。 |
| `POST` | `/api/employee/clubs/:clubId/orders/:orderId/customer-activation` | 原建档订单的当单派单人生成客户端一次性激活链接，返回 `activationUrl` 和毫秒时间戳 `expiresAt`。 |
| `POST` | `/api/user/activate-dispatch-customer` | 客户端来源提交 JSON `{ token, username, password }`，为链接对应的原客户账号设置首次登录凭据。 |
| `POST` | `/api/client/clubs/:clubId/orders` | 登录客户按赠送次数提交本人订单。可填 `dispatcherUserId` 指定合格派单人，省略时随机选人。无候选时创建待分配订单。 |
| `POST` | `/api/client/clubs/:clubId/orders/:orderId/cancel-before-assignment` | 客户提交 `{ requestId }` 取消本人的待分配订单。 |
| `GET` | `/api/employee/clubs/:clubId/orders/pending-assignment` | 团长或副团长分页读取本俱乐部待分配订单。 |
| `GET` | `/api/employee/clubs/:clubId/assignment-candidates` | 团长或副团长读取本俱乐部有效团员的 `{ userId, nickname, dispatcher }`，带派单标记者排在前面。 |
| `POST` | `/api/employee/clubs/:clubId/orders/:orderId/assign-dispatcher` | 团长或副团长提交 `{ requestId, dispatcherUserId }` 为本俱乐部的待分配订单确定派单人。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders` | 客户端查本人已核实归属的订单。团员端查本人负责派单、或已派发且本人承接的订单。 |
| `GET` | `/api/{employee\|client}/clubs/:clubId/orders/:orderId` | 按列表相同的归属范围查询详情。 |
| `GET` | `/api/client/orders` | 跨俱乐部查询归属本人的订单，使用相同的筛选和分页参数。 |
| `GET` | `/api/client/clubs/:clubId/order-options` | 登录客户查看俱乐部名称、可选派单人的昵称和四位 ID。 |
| `GET` | `/api/employee/clubs` | 读取当前团员的有效成员俱乐部、客户端下单链接及待分配操作权限。 |
| `GET` | `/api/admin/clubs/:clubId/orders` | 按俱乐部授权监管该俱乐部所有订单，返回业务状态、客户归属及份额分配。 |
| `GET` | `/api/admin/clubs/:clubId/orders/:orderId` | 在同一监管范围内查询指定订单。 |
| `GET` | `/api/admin/clubs/:clubId/members` | 查询指定俱乐部成员的昵称、四位 ID、成员状态和派单标记。 |
| `PATCH` | `/api/admin/clubs/:clubId/members/:userId/dispatcher` | 用 `{"dispatcher": true}` 或 `{"dispatcher": false}` 更新有效成员的派单标记。 |

下单需要相应端的访问令牌和 JSON 请求体。两个下单入口共用 `requestId`、`recipientGameAccount`、`requestedGiftTimes`，可另填 `estimatedReceivedHearts`。历史 `requestedHearts` 允许同一俱乐部、来源、创建人和标识原样重试已保存的请求。新单一律使用赠送次数。新建、取消和分配各使用 UUID v4，请求重试时沿用相同的 `requestId` 与内容。相同标识配不同内容或争抢已处理的订单返回 HTTP 409。显式指定候选范围之外的账号返回 HTTP 400。随机候选为空时订单的 `dispatchStatus` 为 `pending_assignment`，派单人和归属方式返回 `null`。取消后为 `cancelled`。手动分配后为 `pending`，归属方式为 `manual`。

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

首次正式派发时冻结每次派抽、每次团抽和规则版本。追加独立报价沿用该快照。核款及分工见未结单时追加计价段。[未结单时追加计价段](#未结单时追加计价段)

历史订单保留 `requestedHearts`、原报价和已派发快照。历史报价没有按次标记时，报价按原颗数和每颗单价展示。历史抽成按快照的 `basis` 和版本展示，即使同一笔旧单使用按次抽成，也继续按颗展示原报价。

派单人在「派单准备」保存报价后可登记本人实收。使用 `POST /api/employee/clubs/:clubId/orders/:orderId/receipts`，提交 `pricingRevision`、正整数分 `receivedAmountCents`、带时区的 `receivedAt` 和 UUID v4 `requestId`。服务记录收款人、经办人、两次时间和完整原报价。同一标识与内容可原样重试。报价修改与实收登记同时提交时，只有先写入的请求生效，另一个返回 HTTP 409。实收有差额时保留登记和原报价，订单继续待核款。

后台规则更新后，可通过 `PATCH /api/employee/clubs/:clubId/orders/:orderId/dispatch-commission` 提交 `pricingRevision`、`expectedReviewRevision`（首次为 `0`）、`ruleVersion` 和 `dispatchFeeCents`，复核每次派抽。

实收等于原报价合计且规则仍有效时，派单人可用 `POST /api/employee/clubs/:clubId/orders/:orderId/publish` 正式派发。请求含 UUID v4 `requestId`、`pricingRevision`、`ruleVersion` 和 `commissionReviewRevision`（未复核填 `0`）。相同标识及内容可重试。服务原子写入正式派发时间与首段快照。

### 按次接单与领取汇总

团员从「按次接单」打开本俱乐部已派发订单。写入使用 `POST /api/employee/clubs/:clubId/gift-claims/:orderId`。公开抢单传 UUID v4 `requestId`、`segmentIndex`、`kind: "public"` 和本段本人申报的总日量 `dailyGiftTimes`。提高总日量时只按较前次增加的日量分配，填写相同或更低总日量的新请求返回 HTTP 409。定向承接传 `kind: "directed"` 和本人的 `offerId`。两种请求都可另填 `actualReceivedHearts`。

回执返回申报日量 `requestedDailyGiftTimes`、实际获分的最高日量 `dailyGiftTimes`、实际日程 `schedule` 和份额总次数 `giftTimes`。追加时另返回 `additionalRequestedDailyGiftTimes`。正份额有 `shareId`，0 次结果只保存回执。相同订单、团员、标识和内容的重试返回原回执，包括截量结果。本人用相同标识提交不同内容返回 HTTP 409。订单撤回或停止承接后，有效团员仍可重试本人已保存的操作，或者用 `GET /api/employee/clubs/:clubId/gift-claims/:orderId/receipts/:requestId` 只读核对；新的领取依然受当前状态限制。

团员端在当前标签页按账号、俱乐部、订单、段和动作保留待确认请求。刷新只查询本人回执。未查到时，可在「待确认的领取」点击「重试本次领取」，使用原标识和内容。领取结果或冲突返回后，页面刷新公开余量和本人定向份额。

派单人从「派单准备」查看整单及各段汇总。 `GET /api/employee/clubs/:clubId/orders/:orderId/gift-dispatch` 返回 `totals` 和按报价段排列的 `segmentTotals`，包括付费总次数、净已领、公开待领、定向待确认、未配置和当前不可领。改派前的原份额、日程和实绩仍可查，已移出的份额转入待确认，接手人确认后计入其净承接。接单人只可查本人回执和份额。

## 按次承接关联送心号与登记实际解锁

团员在「按次接单」找到订单，在「我的承接」的份额下点「关联送心号」，逐个选择本人已有的送心号，也可先新建个人送心号。候选按名称和个人编号区分。关联后可登记「已有好友」或「实际新解锁成功」，确认时可填发生时间。同一团员在本单有追加份额、跨段份额时，可为这些份额选择同一个号。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/songxinhao/linkable` | 查本人的 SQLite 送心号。每项含稳定 `id`、十进制字符串 `localId` 和 `name`。 |
| `GET /api/employee/clubs/:clubId/gift-claims/:orderId` | 查已承接份额的 `executionGameAccounts` 和按本人去重的 `fulfillment`。承接人可核对接收游戏号、本人各号的关系、发生与登记时间及费用。 |
| `POST /api/employee/clubs/:clubId/orders/:orderId/shares/:shareId/execution-accounts` | 提交 `{ personalAccountId }` 关联个人号。返回稳定执行账号 `id`、已关联份额 `shareIds`、个人号名称和编号快照。 |
| `POST /api/employee/clubs/:clubId/orders/:orderId/shares/:shareId/execution-accounts/:accountId/relationship` | 提交 `{ relationship, occurredAt? }`。关系取 `existing_friend` 或 `new_unlock`。发生时间为带时区的 ISO 时间，省略时按本次登记时间。相同关系和发生时间重试返回已登记记录，更换关系或发生时间返回 HTTP 409。 |
| `GET /api/employee/clubs/:clubId/orders/:orderId/gift-dispatch` | 当单派单人在「派单准备」打开「解锁核对」，查看 `unlockReview`。分别显示原报价预估、原现金实收、实际新解锁和按送心员汇总的费用。明细列出接收游戏号、老板平台标识和昵称快照、经办团员、送心号及关系。 |

绑定后显示待登记关系。已有好友费用为 0，新解锁费用取原报价约定的每次金额。报价时明确免费可填单价 0，接口可带 `unlock.unitPriceAgreed: true`。留空时页面保存 `unitPriceAgreed: false`，当时若尚未知仍可登记事实，费用为 `null`，另计入待核对次数。旧报价沿用原语义，0 次 × 0 分代表未约定。实际解锁在同一单内按接收游戏号、团员和个人稳定号登记一次，与本人关联的份额数无关。俱乐部、订单、有效成员以及份额归属均由服务端校验。客户侧继续按本人单据核对原报价和现金实收。

个人 SQLite 用独立映射表保存稳定标识，旧记录首次列出时补齐。已有执行记录保存关联时的名称，同一数字编号删除重建后取得新的稳定标识。改派后，原送心者仍有历史记录和原关系；接手人按自己的份额选择自己的个人号。仅存名称的历史按颗执行账号继续按原编号和名称读取。跨单换号、失败、退款、补付与正式结算见[待确认规则](heart-delivery.md#需要业务方确认的决定)。

## 我的日报、补报与更正

实际承接人在「按次接单」找到订单，在「我的承接」份额下关联本人送心号，然后打开订单卡片的「我的日报」。选择执行号，填写业务日期、实际赠送次数和实际到账颗数。留空表示未知，填 0 表示确认到账为零。同一号同一天的一份日报可填写该号已关联的多个份额和实际时段。业务日期由团员填写，业务日与活动边界待 Q2 确认。[数量与金额口径](heart-delivery.md#数量与金额的口径)

补报和未入账日报更正提交即生效，需填原因。关闭领取或暂停新执行后，过去的实绩仍可补报和更正。历史保留各版本、前后值、经办人、账面业务日期、双方游戏号快照与服务端提交时间。正式按次进度使用每份日报的最新版本，按实际赠送次数抵扣本人净份额，超额次数单列。双倍期已送 4 次计履约 4 次，按实际期别预计到账 8 颗，实际据实填写。普通待结依据用份额内次数乘原段每次单价，减去该单每次派抽和团抽。提交日报只更新业务事实及待结依据。已入账后更正与资金处理待 Q4、Q5 确认。

历史按颗订单的日报历史返回 `priceUnit: "received_hearts"`。原日报按实际到账抵扣颗数，旧补报和更正仍显示原有的待核对状态。旧报告的次数、颗数、版本和原因继续可查。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/clubs/:clubId/orders/:orderId/daily-reports` | 每页读取本人的 25 条日报版本，用 `nextCursor` 作下一页的 `after`。按次单另返回 `giftProgress`。 |
| `POST /api/employee/clubs/:clubId/orders/:orderId/shares/:shareId/execution-accounts/:accountId/daily-reports` | 给本人承接中已关联的账号提交日报。`kind` 取 `daily` 或 `supplement`，补报需填 `reason`。`businessDate` 格式为 `YYYY-MM-DD`。 |
| `POST /api/employee/clubs/:clubId/orders/:orderId/daily-reports/:reportId/corrections` | 给本人的日报追加更正。`reportId` 取历史项的 `originalId`，提交当前 `expectedVersion` 与 `reason`。 |

两种写入均提交 UUID v4 `requestId` 和 `lines`。按次明细包含非负整数 `giftTimes` 和非负整数或 `null` 的 `receivedHearts`。省略 `receivedHearts` 同样表示未知。可填行级 `shareId` 选择该号已关联的本人份额，省略时使用首报路由的份额。计价段由份额确定，可选填 `quoteSegment` 核对对应的从 1 开始的段号。可填实际 `period`（`normal`、`double` 或 `unconfirmed`），省略则沿用该段约定时段。已知和未知实际到账均直接保留。

团员填写业务日期，可为同一份额添加普通期、双倍期和实际时段待核对的明细。「我的日报」的实际时段默认选中「待核对」，提交时记为 `unconfirmed`。按次 `giftProgress` 的 `deliveredGiftTimes`、`remainingGiftTimes`、`observedGiftTimes`、`excessGiftTimes` 及 `shares` 按本人净份额汇总。`segments` 返回本人各段的 `quotePeriod`、`unitPriceCents`、进度、分期实绩及待结依据。全单已送和剩余分列为 `orderDeliveredGiftTimes` 和 `orderRemainingGiftTimes`，建单预计到账见 `estimatedReceivedHearts`。份额的 `claimObservedReceivedHearts` 是接单时的单次观察值。派单人从本单按次分工查看各份额已送次数并改派剩余。

同一订单、承接人、执行号与业务日只接受一份首报或补报。原请求可按相同标识和内容重试。另用新标识重复同日、重用标识修改内容或基于过期版本更正时，返回 HTTP 409。待写记录通过订单履约版本与改派互斥，单节点 MongoDB 支持写入及恢复。

## 派单监督与客户交付进度

团员端进入「派单准备 → 履约监督」。在「履约异常队列」选择一个已结束的业务日，系统以该日期及之前的有效日报核对。每段分别展示单价、约定次数、日量、执行窗口、已领、未领及已送。派单人可展开团员，再展开具体份额。按改派后的净日计划区分漏报、零送已报、部分不足、正常及尚未到核对日。份额过期后仍未送的次数单列，完整改派的份额保留原窗口及记录。团员自己的日历排期独立保存。补报和未结单日报更正以最新有效版本实时计入。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/clubs/:clubId/orders/fulfillment-exceptions?through=YYYY-MM-DD` | 当单派单人查本人异常队列。可用 `after`、`limit` 和 `source`。 |
| `GET /api/employee/clubs/:clubId/orders/:orderId/fulfillment` | 当单派单人查看订单、段、团员及具体份额。传 `through` 时以该业务日为截止，包含当日。未选择核对日时展示当前累计和已填日报。 |
| `GET /api/client/orders` 与 `GET /api/client/clubs/:clubId/orders/:orderId` | 老板查看归属本人的直接派单和客户端订单。老板视图仅返回客户侧金额及履约汇总。 |

按次的 `deliveryProgress.priceUnit` 为 `gift_times`。老板在「我的订单」和订单详情核对整单及各段的约定、已送和剩余次数。建单预计实收与接单时登记的实际实收、日报实际到账分别展示。接单实收使用匿名、去重的观察值及未知数。日报累计取各有效日报实际到账，所有明细都已知时给出合计，存在未知时另给已知小计及未知明细数。明确零到账显示 0。履约送完和派单人确认结单各有状态，`closedAt` 取已记录的结单事实。结单后保留日报历史，关闭普通补报与更正写入。

### 按实际时段拆分实绩

本人日报、派单监督及老板交付进度的 `periods` 按各有效日报明细的实际 `period` 分组。报价期别和建单预计均保留。同一段、账号和业务日可有多个实际期别。派单监督按全单、报价段、成员和净份额查看。老板按本人订单和报价段查看分期，成员、账号和内部报酬由团员端按权限核对。

| 字段 | 口径 |
| --- | --- |
| `observedGiftTimes` / `deliveredGiftTimes` | 实报次数及计入约定的次数。按净份额限制，超出部分见 `excessGiftTimes`。一份额跨实际时段且超出净份额时，如需决定实报次数在哪个时段计入，相关时段的计入次数与金额为 `null`，待业务核对。 |
| `estimatedDeliveredHearts` | 按已实报赠送次数和实际期别估算，普通期每次 1 颗、双倍期每次 2 颗。包含实际时段待核对的正赠送次数时，相应合计为 `null`，已知期别仍各自显示预计。 |
| `actualReceivedHearts` | 日报实收汇总。存在未知明细时为 `null`，同时返回 `knownReceivedHearts`、`knownReceivedLines`、`unknownReceivedLines`，明确到账 0 颗计入已知。接单时的观察值单列。 |
| `heartAmountCents` / `pendingCompensation` | 已计入约定的次数乘所属计价段的原单价。团员可查看本人按首段锁定的每次派抽和团抽计算的待结报酬。超出份额部分待业务处理。 |
| `periodOnlyDifferenceCents` | 老板和派单人核对仅改变到账倍率的价差，值为 0。赠送次数和各段单价沿用原约定，原报价及已登记实收可分别查阅。日报及分期汇总只更新履约记录，补款、退款和入账有各自的业务入口。 |

### 未结单时追加计价段

已正式派发的按次订单在可继续履约且尚未结单时，老板可在订单详情点「在原单追加计价段」，包括已完成原约定次数的订单。老板填写新段的期别、总次数、每日日量和起止日。当单派单人在「派单准备 → 报价与派发规则 → 续段处理」为该申请填写每次单价。老板确认报价后，派单人登记实际收到的全额款和收款时间。核款后，新段的次数进入全单约定和派单分工。派单人在同页「按次派发与分工」使用报价执行窗口配置公开领取或定向承接。各段独立计价，整单沿用首段每次派抽和团抽。原单的报价、原实收、历次续段报价和实收分别保留。老板可核对初次订购、当前约定次数、原报价和原收款。累计已登记收款合计原收款与已核款续段。

下表路径相对于对应端的 `/api/{client|employee}/clubs/:clubId/orders/:orderId`。写入所用的 `requestId` 为 UUID v4。

| 端 | 请求 | 载荷 |
| --- | --- | --- |
| 客户端 | `POST /continuation-requests` | `{ requestId, period, paidGiftTimes, dailyGiftTimes, startDate, endDate }` |
| 团员端 | `POST /continuation-quotes` | `{ requestId, customerRequestId?, segment: { period, paidGiftTimes, dailyGiftTimes, unitPriceCents }, window? }`。有老板申请时沿用申请的期别、次数、日量及窗口。 |
| 团员端 | `PATCH /continuation-quotes/:quoteId/window` | 对已有的无窗口报价登记 `{ startDate, endDate }`，可按原日期重试。 |
| 客户端 | `POST /continuation-quotes/:quoteId/acceptance` | 本单老板提交 `{ requestId }`，确认明确的续段报价。 |
| 团员端 | `POST /continuation-quotes/:quoteId/receipt` | `{ requestId, receivedAmountCents, receivedAt }`。实收必须与该笔续段报价相符，时间须带时区。返回激活的、从 0 开始的 `segmentIndex`。 |

续段报价、确认与实收可按相同提交标识及内容重试。确认报价和核款使用同一订单的续段版本，避免重复激活。已核款的新段采用既有的按次派发与领取接口。[结单与续单](heart-delivery.md#结单与续单)
