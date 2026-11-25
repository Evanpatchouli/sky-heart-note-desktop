# 俱乐部共享订单 API

共享送心订单与俱乐部成员关系保存在服务端使用的 MongoDB 中。团员端的个人预约和送心号仍使用各团员自己的 SQLite 库。业务场景见[俱乐部业务说明](club-business.md)和[送心细则](heart-delivery.md)。

新单按赠送次数订购，报价记录段次数、日量和每次单价。建单预计实收单列爱心颗数。首次派发冻结每次抽成，续段沿用首段派抽和团抽。[正式业务口径](heart-delivery.md#订单分段)

新单的个人让利、平台优惠和促销赠送在原有报价、核款、派发与履约流程中办理。[按次优惠](#按次优惠)

按次优惠结算待 P1-16～P1-18 接入。已履约部分按原单价及抽成核算报酬，按确认报价追溯每类已兑现优惠。本单派单人确认结单后，个人账簿分列派抽原额和个人让利，团费账簿分列团抽原额、「平台优惠」与「赠送成本」。个人让利可超过本单派抽，个人余额可记为负数。[优惠结算算例](heart-delivery.md#优惠的使用和出资)

P1-14 待按确认报价锁定的分摊明细核平已履约爱心款和应退爱心款。未履约付费次数按其折后价款核算，剩余促销赠送次数对应零退款。满减资格沿用确认报价时的判定，已履约次数保留成交优惠。退单返券以最新有效日报累计的实际赠送次数为准，累计 0 次可返券。券返还和现金应退分别处理。应退服务款和实退分别记录。[正式退款规则与算例](heart-delivery.md#活动与异常如何处理) · [退单与优惠券返还](heart-delivery.md#退单与优惠券返还)

## 初始化俱乐部

每套安装使用同一个俱乐部。API 从空库启动时保存 `CLUB_NAME` 或默认值「送心手记」。此后由本团有效团长在团员端修改名称，重启与其他 API 实例沿用数据库中的值。

按[首次启用俱乐部运营](../README.md#首次启用俱乐部运营)为拥有团员端准入的启用账号运行一次 `init-leader <四位用户ID>`。团长登录团员端，从「账户菜单 → 俱乐部运营」维护成员和授权。副团长职务由团长调整。派单标记与职务各自独立。停用成员会清空其运营授权，并保留历史订单归属。恢复后可重新授予所需权限。

老板主动指定与系统随机指定均限本俱乐部有效且带“派单”标记的团员。无候选时创建待分配订单，之后新增候选不会改变原订单。团长或副团长从团员端「派单准备 → 待分配订单」选择任一有团员端准入的本俱乐部有效成员，带“派单”标记者优先显示。手工分配只确定本单派单人。分配前老板可在本人订单详情取消。

取消与分配同时提交时只有一项生效。建单重试取回原单，不重新选人。取消及分配重试取回原决定，即使订单已进入下一阶段。在当前标签页未收到分配回执时，「待分配订单」保留「重试本次分配」入口。订单记录客户端来源、客户、原建单请求和归属方式，手工决定另外记录操作人、时间与请求标识。分配后仍由当单派单人在「派单准备」核款并主动派发。[正式归属规则](club-business.md#订单来源)

## 客户端下单入口

客户从客户端「下单」或直接打开 `/order` 进入本团表单。团员在「派单准备」可复制完整的客户端地址，例如 `https://client.example.com/order`。客户填写接收游戏账号、赠送次数，可另填期望交付时段与预计实收爱心颗数。本人订单详情使用 `/order-detail?order=<订单ID>`。

没有合格候选时，客户可以提交待分配订单。网络结果不明时，客户端在当前标签页按客户账号保留原请求和未提交草稿，点击「重试本次提交」可取回已创建的订单。

## 俱乐部运营权限

有效团长默认可办理成员管理和每次团抽配置。团长在「俱乐部运营」查看有效团员，逐项授予或收回业务权限，并可授予或收回副团长职务。副团长可按职务分配待分配订单，办理运营事项时按明确授予的权限执行。财务明细始终按财务权限或订单本人的具体职责读取。

| 权限码 | 用途及准入 |
| --- | --- |
| `CLUB_MEMBERS_MANAGE` | 在团员端维护本团启用成员、普通成员停用状态及派单候选标记。管理端会话也可查看本团成员及调整派单候选标记。 |
| `CLUB_COMMISSION_MANAGE` | 在团员端或管理端读取和更新每次团抽。管理端的优惠设置沿用此权限。 |
| `CLUB_ORDERS_READ` | 通过管理端会话读取本团订单的监管视图。与团抽配置权限合用可读已派发订单的规则摘要。 |
| `CLUB_FINANCE_READ` | 通过管理端会话读取相应财务明细。 |

管理端准入由平台角色管理。每次业务请求实时核对当前账号的有效成员身份、职务和所需单项权限。授予或收回在已登录账号的下次请求生效。仅团长可修改名称、管理授权和副团长职务。

| 方法 | 路径 | 操作 |
| --- | --- | --- |
| `GET` | `/api/employee/club` | 有效团员读取本团名称、客户端下单链接和本人运营能力。无有效成员身份时返回空值。 |
| `PATCH` | `/api/employee/club/name` | 团长提交 `{ name }`，去除首尾空白后为 1 至 80 个字符。 |
| `GET` | `/api/employee/club/members` | 获成员管理权限的团员读取本团成员。 |
| `PUT` | `/api/employee/club/members/:userId` | 提交 `{ active }`。添加或恢复具备团员端准入的账号，或停用普通成员。 |
| `PATCH` | `/api/employee/club/members/:userId/dispatcher` | 提交 `{ dispatcher }` 更新有效成员的派单候选标记。 |
| `GET`、`PATCH` | `/api/employee/club/commission-rule` | 获团抽配置权限的团员读取或提交 `{ expectedVersion, clubFeeCents }`。首次配置的预期版本为 0。 |
| `GET` | `/api/employee/club/authorizations` | 团长读取有效团员的职务、权限及可授予的权限。 |
| `PATCH` | `/api/employee/club/authorizations/:userId/permission` | 团长提交 `{ permission, granted }`。 |
| `PATCH` | `/api/employee/club/authorizations/:userId/deputy` | 团长提交 `{ deputy }`，授予或收回副团长职务。 |
| `GET` | `/api/admin/club` | 读取本团名称及当前账号在管理端可用的业务权限。 |

## 按次派发、承接和注册邀请

在团员端的「派单准备」核对已付报价，选择「正式派发」，为每段填写执行日期。每段可保留公开份额，也可为本团有效团员填写每日负责次数和各自的预期窗口。仅定向时须覆盖该段全部次数。通过旧版接口已核款并正式派发的按次订单，由原派单人在「按次派发与分工」补配。原派发状态、抽成和收款继续沿用。兼容补配沿用原派发记录。

「按次接单」只列已派发且有公开份额或本人份额的订单。团员可填每日能赠送的次数，系统按领取顺序和逐日余量发放，预留的定向份额由受邀团员主动确认。每段只可领取一次公开份额。即使是本单派单人，也可领取公开份额或确认指定给自己的份额。双倍期预计到账、接单时实收爱心及现金实收分别记录。接单实收可留空，`0` 颗表示已记录为零。

本单派单人可把尚未送出的次数全部或部分改派给本团另一位有效团员，接手人确认后获得该段的相应份额。已送次数按同一份额的最新日报版本核对，原日报和人员归属保留。改派网络结果不明时，可在原订单重试同一次请求。

有效团员可在「派单准备」生成本团注册邀请。链接有效期为 24 小时，仅限创建一个新账号，直接进入该俱乐部的普通团员身份。新团员设置登录凭据并入团后可在团员端登录，派单人刷新选人列表后可选到该账号。

| 方法 | 挂在 `/api` 下的路由 | 操作 |
| --- | --- | --- |
| `POST` | `/employee/club/orders/:orderId/publish` | 原发布字段可附带 `giftDispatchSegments`，每项含 `segmentIndex`、`startDate`、`endDate`、`openToClaim` 和 `directed`。定向项含 `userId`、`dailyGiftTimes`、`startDate`、`endDate`。 |
| `GET`、`POST` | `/employee/club/orders/:orderId/gift-dispatch` | 当单派单人读分工或补配未配置的已付段。补配提交 `{ requestId, segments }`，每项与正式派发分工的结构相同。 |
| `GET` | `/employee/club/gift-claims`、`/employee/club/gift-claims/:orderId` | 读取当前团员可见的按次派单。定向份额和已领取详情按身份裁剪，执行日期相连且日量相同的记录合并显示。 |
| `POST` | `/employee/club/gift-claims/:orderId` | 公开提交 `{ requestId, segmentIndex, kind: "public", dailyGiftTimes }`。定向提交 `{ requestId, segmentIndex, kind: "directed", offerId }`。两种承接均可传 `actualReceivedHearts`。回执包含获分 `giftTimes` 和 `dailyGiftTimes`。正份额另有 `shareId`。 |
| `POST` | `/employee/club/orders/:orderId/gift-dispatch/reassign` | 提交 `{ requestId, shareId, userId, giftTimes? }`。省略次数时改派全部未送次数，返回给新团员的待确认定向份额。 |
| `GET` | `/employee/club/gift-candidates` | 查询团内当前可接单的有效成员。 |
| `POST` | `/employee/club/member-invitations` | 有效团员取得本团一次性注册链接和截止时间。 |
| `POST` | `/client/club-invitations/register` | 通过客户端来源提交 `{ token, username, password }`，完成新团员入团。 |

段序号从 0 开始，执行日期为 `YYYY-MM-DD`，窗口包含首尾日。请求标识用 UUID v4。新增续段仍须先核款，待核款的续段报价不会进入可接单列表。历史按颗订单沿用既有数量、金额及已发记录。

## 写入与查询

| 方法 | 路由 | 可执行的操作 |
| --- | --- | --- |
| `GET` | `/api/employee/club/order-customers?q=关键词` | 有效团员按用户名、昵称或四位 ID 搜索可进入客户端的启用账号，最多返回 20 条 `{ userId, nickname }`。完整 ID 优先，其次是完整用户名、昵称。 |
| `POST` | `/api/employee/club/orders` | 有效团员新建直接派单草稿，选择已有用户或填写新老板昵称。创建人与本单派单人均为当前团员。 |
| `POST` | `/api/employee/club/orders/:orderId/customer-activation` | 原建档订单的当单派单人生成客户端一次性激活链接，返回 `activationUrl` 和毫秒时间戳 `expiresAt`。 |
| `POST` | `/api/user/activate-dispatch-customer` | 客户端来源提交 JSON `{ token, username, password }`，为链接对应的原客户账号设置首次登录凭据。 |
| `POST` | `/api/client/orders` | 登录客户按赠送次数提交本人订单。可填 `dispatcherUserId` 指定合格派单人，省略时随机选人。无候选时创建待分配订单。 |
| `POST` | `/api/client/orders/:orderId/cancel-before-assignment` | 客户提交 `{ requestId }` 取消本人的待分配订单。 |
| `GET` | `/api/employee/club/orders/pending-assignment` | 团长或副团长分页读取本俱乐部待分配订单。 |
| `GET` | `/api/employee/club/assignment-candidates` | 团长或副团长读取本俱乐部有效团员的 `{ userId, nickname, dispatcher }`，带派单标记者排在前面。 |
| `POST` | `/api/employee/club/orders/:orderId/assign-dispatcher` | 团长或副团长提交 `{ requestId, dispatcherUserId }` 为本俱乐部的待分配订单确定派单人。 |
| `GET` | `/api/employee/club/orders`、`/api/client/orders` | 客户端查本人已核实归属的订单。团员端查本人负责派单、或已派发且本人承接的订单。 |
| `GET` | `/api/employee/club/orders/:orderId`、`/api/client/orders/:orderId` | 按列表相同的归属范围查询详情。 |
| `GET` | `/api/client/club/order-options` | 登录客户查看俱乐部名称、可选派单人的昵称和四位 ID。 |
| `GET` | `/api/admin/club/orders` | 按本团业务授权监管订单，返回业务状态、客户归属及份额分配。 |
| `GET` | `/api/admin/club/orders/:orderId` | 在同一监管范围内查询指定订单。 |
| `GET` | `/api/admin/club/members` | 查询本团成员的昵称、四位 ID、成员状态和派单标记。 |
| `PATCH` | `/api/admin/club/members/:userId/dispatcher` | 用 `{"dispatcher": true}` 或 `{"dispatcher": false}` 更新有效成员的派单标记。 |

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

客户端「我的订单」可展开本人订单，核对建单预计实收爱心、各段单价与数量、折后应付服务款和登记的实收金额与时间。直接派单和客户端下单使用同一报价及收款流程。

## 固定金额抽成与派单准备

管理端通过 `GET /api/admin/club/commission-rule` 查当前规则，通过相同路径的 `PATCH` 更新。派单人通过 `GET /api/employee/club/orders/:orderId/pricing` 查报价和规则，通过相同路径的 `PATCH` 保存报价。

管理端只填写每次团抽，派单人只填写每次服务单价与每次派抽。金额使用整数分。规则更新请求包含 `expectedVersion` 和 `clubFeeCents`，首次配置使用版本 `0`。报价更新请求包含 `ruleVersion`、`expectedRevision`（首次为 `0`）、`dispatchFeeCents` 和 `giftSegments`。两类请求可省略 `basis`，显式填写时仅接受 `gift_times`。已有按颗团抽须由具备本俱乐部权限的管理员填写新的每次金额后启用。规则或报价版本已变化时，服务返回 HTTP 409。

按次报价的 `priceUnit` 为 `gift_times`。每段含 `period`（`normal` 或 `double`）、`paidGiftTimes`（付费赠送次数）、`dailyGiftTimes`（日量）和 `unitPriceCents`（每次服务单价）。各段付费次数合计等于原订购次数。按付费次数乘每次单价计算报价。建单预计实收颗数单列，普通期和双倍期的同量同价订单具有相同爱心款。

按次报价返回折后服务款 `heartsAmountCents` 和同额的应付 `totalAmountCents`。报价请求携带解锁费用字段时返回 HTTP 400。[取消解锁收费与补贴](heart-delivery.md#取消解锁收费与补贴)

应付为 0 分时，由本单派单人点击「确认零元单」，以 `receivedAmountCents: 0` 登记后才能正式派发。送心报酬按原单价和抽成约定核算。

首次正式派发时冻结每次派抽、每次团抽和规则版本。追加独立报价沿用该快照。核款及分工见未结单时追加计价段。[未结单时追加计价段](#未结单时追加计价段)

历史订单保留 `requestedHearts`、原报价和已派发快照。历史报价没有按次标记时，报价按原颗数和每颗单价展示。历史抽成按快照的 `basis` 和版本展示，即使同一笔旧单使用按次抽成，也继续按颗展示原报价。

派单人在「派单准备」保存报价后可登记本人实收。使用 `POST /api/employee/club/orders/:orderId/receipts`，提交 `pricingRevision`、整数分 `receivedAmountCents`、带时区的 `receivedAt` 和 UUID v4 `requestId`。服务记录收款人、经办人、两次时间和完整原报价。同一标识与内容可原样重试。报价修改与实收登记同时提交时，只有先写入的请求生效，另一个返回 HTTP 409。实收有差额时保留登记和原报价，订单继续待核款。

后台规则更新后，可通过 `PATCH /api/employee/club/orders/:orderId/dispatch-commission` 提交 `pricingRevision`、`expectedReviewRevision`（首次为 `0`）、`ruleVersion` 和 `dispatchFeeCents`，复核每次派抽。

实收等于原报价合计且规则仍有效时，派单人可用 `POST /api/employee/club/orders/:orderId/publish` 正式派发。请求含 UUID v4 `requestId`、`pricingRevision`、`ruleVersion` 和 `commissionReviewRevision`（未复核填 `0`）。服务在订单中同时保存派发状态、时间、首段快照和待投递事件。相同标识及内容重试返回同一发布结果及 `publicationId`。

### 全团站内派单通知

直接派单和客户端下单统一在本单派单人成功发布后通知本团。收件名单固定为发布当时具有团员端准入的有效团员，包括派单人、没有派单标记的团员和未订阅系统推送的团员。工作人员保存草稿或老板下单、系统确定接待派单人时，订单仍待派发。此时本单派单人可在同一铃铛查看待接待的客户端订单。

后台按发布 ID 和收件人去重写入，服务重启后可补齐原名单中的通知，保留已写记录及首次已读时间。新派单在团员端以「重要」显示。点击「前往接单区」进入 `/claim-board?noticeId=…`，把对应的按次订单置于列表顶部并标为已读。打开、返回或刷新只查询接单数据，领取需本人主动提交。通知不可访问、目标订单被抢完、撤回、停送、尚未配置分工或仅指定给他人时，接单区提示当前状态，其他有权查看的订单仍可浏览。

| 方法 | 路由 | 操作 |
| --- | --- | --- |
| `GET` | `/api/employee/dispatch-notices` | 查询本人通知。使用 `limit`（默认 25，最多 100）和 `after` 分页，返回 `items`、`nextCursor` 和 `hasUnread`。通知的 `type` 为 `important`，`targetApp` 为 `employee`。 |
| `GET` | `/api/employee/dispatch-notices/unread` | 返回本团有效团员本人通知的 `hasUnread`。 |
| `GET` | `/api/employee/dispatch-notices/:noticeId/claim-board` | 按本人通知、当前成员身份及原发布事件定位，返回 `status`。`gift_located` 同时返回当前可见的 `order`。超出通知权限时返回 `missing`。 |
| `PATCH` | `/api/employee/dispatch-notices/:noticeId/read` | 标记本人通知已读，返回通知 ID 和首次已读时间。 |

### 按次优惠

现行按次报价允许本单个人让利、一种平台优惠和促销赠送叠加。先按折前付费服务款核算平台优惠，再扣个人让利。用券有效时由券替代全场折扣，未用券时自动执行本团有效全场折扣。每笔金额优惠按各段折前付费服务款分摊到付费次数，整分明细和优惠来源随报价保留。[优惠的使用和出资](heart-delivery.md#优惠的使用和出资)

有本团规则管理权限的管理员可在「抽成规则 → 平台优惠」启停全场折扣和向指定平台客户发券。读取及更新活动使用 `GET/PATCH /api/admin/club/promotions`，更新送 `expectedVersion`、活动名与实付比例（万分比，例如九折填 `9000`）。发券使用 `POST /api/admin/club/promotions/coupons`，填写领券客户短 ID、券名、券种、对应金额或实付比例和 UUID v4 请求标识。

客户下单选项返回本人在本团尚可使用的券，建单可传 `platformCouponId` 表示用券意向。接待通知在团员端站内铃铛中仅向本单派单人展示，点击打开对应订单的派单准备。正式发布后，抢单通知按全团接单通知流程处理。派单准备返回该老板名下可用券和预填选择。在报价时传 `platformCouponId` 更换券，传 `null` 表示不用券。折前服务款未达到门槛或券已不可用时，报价记录原因与实际生效的优惠。登记实收保存完整报价与券使用记录，数据库确保一张券只被一笔订单占用。

报价请求可传整数分 `personalDiscountCents`，并在每个 `giftSegments` 项填写 `promotionalGiftTimes`。赠次由本团团费承担，各段合计上限是整单非赠送付费次数的 10% 向下取整。每个有赠送的报价段生成单独的赠送履约段，沿用对应付费段的期别和每次服务价。日报以整单已核款付费次数的完成情况核算赠送；迟报或更正按实际履约日期及相关续段窗口核对。

### 按次接单与领取汇总

团员从导航进入 `/claim-board` 查看本俱乐部已派发的按次订单。列表和详情使用 `GET /api/employee/club/gift-claims` 和 `GET /api/employee/club/gift-claims/:orderId`。列表支持 `filter=all`（默认）、`filter=public`（公开份额仍可领取）及 `filter=directed`（本人有待确认的指定份额）。按筛选后的订单分页，下一页沿用当前筛选和返回的 `nextCursor`。每段分别显示公开待领总次数、最高日量、按日余量、本人获指派的份额及已承接记录。本人承接后可核对接收游戏号。

主动领取使用 `POST /api/employee/club/gift-claims/:orderId`。公开抢单传 UUID v4 `requestId`、`segmentIndex`、`kind: "public"` 和本段本人申报的总日量 `dailyGiftTimes`。提高总日量时只按较前次增加的日量分配，填写相同或更低总日量的新请求返回 HTTP 409。定向承接传 `kind: "directed"` 和本人的 `offerId`。两种请求都可另填 `actualReceivedHearts`，此字段单独记录爱心颗数。领取只分配赠送次数，日报更新履约实绩。

回执返回申报日量 `requestedDailyGiftTimes`、实际获分的最高日量 `dailyGiftTimes`、实际日程 `schedule` 和份额总次数 `giftTimes`。追加时另返回 `additionalRequestedDailyGiftTimes`。正份额有 `shareId`，0 次结果只保存回执。相同订单、团员、标识和内容的重试返回原回执，包括截量结果。本人用相同标识提交不同内容返回 HTTP 409。订单撤回或停止承接后，有效团员仍可重试本人已保存的操作，或者用 `GET /api/employee/club/gift-claims/:orderId/receipts/:requestId` 只读核对；新的领取依然受当前状态限制。

团员端在当前标签页按账号、俱乐部、订单、段和动作保留待确认请求。刷新只查询本人回执。未查到时，可在「待确认的领取」点击「重试本次领取」，使用原标识和内容。领取结果或冲突返回后，页面刷新公开余量和本人定向份额。

派单人从「派单准备」查看整单及各段汇总。 `GET /api/employee/club/orders/:orderId/gift-dispatch` 返回 `totals` 和按报价段排列的 `segmentTotals`，包括付费总次数、净已领、公开待领、定向待确认、未配置和当前不可领。改派前的原份额、日程和实绩仍可查，已移出的份额转入待确认，接手人确认后计入其净承接。接单人只可查本人回执和份额。

## 三端通知与设备提醒

以下接口使用当前端的 Bearer 令牌和 Origin。路径中的 `app` 只能是 `admin`、`employee` 或 `client`。每个登录会话最多关联一个设备订阅，同一端点也只能绑定到一个会话。其他端和其他设备需分别开启。

| 方法 | 路由 | 请求与响应 |
| --- | --- | --- |
| `GET` | `/api/{app}/notifications` | 以 `limit`（默认 25，最多 100）及 `after` 分页，返回 `items`、`hasUnread`、`nextCursor`。团员端历史派发和新通知使用同一收件箱。 |
| `GET` | `/api/{app}/notifications/:id` | 查询本端、本人仍可见的通知。客户端订单接待额外校验当前派单人。 |
| `PATCH` | `/api/{app}/notifications/:id/read` | 标为已读，重试返回同一已读时间。普通通知标读后移出收件箱。 |
| `GET` | `/api/{app}/notification-push` | 返回 `{ publicKey, fingerprint }`。未配置服务或当前会话无订阅时，对应字段为 `null`。 |
| `PUT` | `/api/{app}/notification-push` | 传入 `{ endpoint, keys: { p256dh, auth }, applicationServerKey }`。其中 `applicationServerKey` 为 GET 返回的 VAPID 公钥。重复提交同一当前订阅返回现有指纹。 |
| `DELETE` | `/api/{app}/notification-push` | 解除当前会话的设备绑定，可以重复调用。状态核对时可传入 `{ fingerprint }`，只在该指纹仍匹配时解除。 |

设备指纹为 `JSON.stringify([endpoint, p256dh, auth])` 的 UTF-8 SHA-256 无填充 Base64URL 编码，`endpoint` 使用浏览器 URL 序列化结果。订阅端点和设备密钥由服务端保存，VAPID 私钥只来自 API 环境变量。已有团员端 `/api/employee/dispatch-push` 接口和该端订阅继续有效。

在可信服务端用 `AppNotificationService.publish({ eventKey, targetApp, type, recipientUserIds, title, body? })` 持久化目标端及收件人快照。相同端和事件键重复调用时返回原事件，要求收件人和内容一致。普通 `normal` 仅写收件箱，重要 `important` 写收件箱并调度设备投递，系统 `system` 仅使用 PWA 展示，服务端保留投递核对记录。也可在使用相同 MongoDB 配置的可信部署环境调用：

```sh
pnpm --dir server club:configure notify employee important sample.event.001 00A1 "标题" "内容"
```

后台按事件 ID 和设备订阅 ID 生成投递记录，发送前核对当前账号、本端权限、登录和设备绑定代次，以及涉及俱乐部业务时的有效成员身份。事件发生前已开启的设备可在 15 分钟有效期内接收。暂时故障按退避间隔和 `Retry-After` 重试，`404/410` 解除相应代次的绑定。网关收到相同 `Topic` 时可合并待送通知，应用以事件和收件记录的固定标签合并展示。网关受理状态可通过事件 ID 核对 `club_dispatch_push_deliveries`，实际设备展示与点击另行验证。

三端 Service Worker 校验负载版本、会话绑定和有效期，只打开本站约定目标。全团派发沿用 `club-dispatch`、`publicationId` 和 `noticeId`，进入 `/claim-board?noticeId=…`。其他类型加密负载采用 `app-notification`，含 `targetApp`、`noticeType`、`notificationId`、`noticeId`、`target`、`title`、`message`、`deviceBinding` 和 `expiresAt`。客户端下单被分配后，重要通知进入团员端 `/club/dispatch?notificationId=…`，校验归属后填入派单准备。其他重要通知打开本端铃铛的对应条目，系统通知打开本端入口。三端点击都先使用本端登录，随后重新校验通知或业务对象的访问权。

## 按次承接关联送心号

团员在「按次接单」找到订单，在「我的承接」的份额下点「关联送心号」，逐个选择本人已有的送心号，也可先新建个人送心号。候选按名称和个人编号区分。关联后即可使用该号写日报、补报或更正。同一团员在本单有追加份额、跨段份额时，可为这些份额选择同一个号。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/songxinhao/linkable` | 查本人的 SQLite 送心号。每项含稳定 `id`、十进制字符串 `localId` 和 `name`。 |
| `GET /api/employee/club/gift-claims/:orderId` | 查接收游戏号和已承接份额里属于本人的 `executionGameAccounts`。 |
| `POST /api/employee/club/orders/:orderId/shares/:shareId/execution-accounts` | 提交 `{ personalAccountId }` 关联个人号。返回稳定执行账号 `id`、已关联份额 `shareIds`、个人号名称和编号快照。 |

俱乐部、订单、有效成员及份额归属由服务端校验。相同关联重试返回原执行账号。客户按本人单据核对报价和现金实收。

个人 SQLite 用独立映射表保存稳定标识，旧记录首次列出时补齐。已有执行记录保存关联时的名称，同一数字编号删除重建后取得新的稳定标识。改派后，原送心者仍保留原关联和实绩；接手人按自己的份额选择自己的个人号。仅存名称的历史按颗执行账号继续按原编号和名称读取。

## 我的日报、补报与更正

实际承接人在「按次接单」找到订单，在「我的承接」份额下关联本人送心号，然后打开订单卡片的「我的日报」。选择执行号，填写业务日期、实际赠送次数和实际到账颗数。留空表示未知，填 0 表示确认到账为零。同一号同一天的一份日报可填写该号已关联的多个份额和实际时段。业务日按北京时间 0 点切换，普通期和双倍期以游戏公告的实际生效和结束时刻为准。[数量与金额口径](heart-delivery.md#数量与金额的口径)

补报和未入账日报更正提交即生效，需填原因。改价协商、待实际补款或拒补停送时，可以补报暂停前的实绩或更正已有日报。历史保留各版本、前后值、经办人、账面业务日期、双方游戏号快照与服务端提交时间。正式按次进度使用每份日报的最新版本，按实际赠送次数抵扣本人净份额。无约定的超额实绩单列，费用及报酬均按约定上限计算。双倍期已送 4 次计履约 4 次，按实际期别预计到账 8 颗，实际据实填写。普通待结依据用份额内次数乘适用段每次单价，减去该单每次派抽和团抽。已结单更正及差额流水见第 37 问和 P1-17。

历史按颗订单的日报历史返回 `priceUnit: "received_hearts"`。原日报按实际到账抵扣颗数，旧补报和更正仍显示原有的待核对状态。旧报告的次数、颗数、版本和原因继续可查。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/club/orders/:orderId/daily-reports` | 每页读取本人的 25 条日报版本，用 `nextCursor` 作下一页的 `after`。按次单另返回 `giftProgress`。 |
| `POST /api/employee/club/orders/:orderId/shares/:shareId/execution-accounts/:accountId/daily-reports` | 给本人承接中已关联的账号提交日报。`kind` 取 `daily` 或 `supplement`，补报需填 `reason`。`businessDate` 格式为 `YYYY-MM-DD`。 |
| `POST /api/employee/club/orders/:orderId/daily-reports/:reportId/corrections` | 给本人的日报追加更正。`reportId` 取历史项的 `originalId`，提交当前 `expectedVersion` 与 `reason`。 |

两种写入均提交 UUID v4 `requestId` 和 `lines`。按次明细包含非负整数 `giftTimes` 和非负整数或 `null` 的 `receivedHearts`。省略 `receivedHearts` 同样表示未知。可填行级 `shareId` 选择该号已关联的本人份额，省略时使用首报路由的份额。计价段由份额确定，可选填 `quoteSegment` 核对对应的从 1 开始的段号。可填实际 `period`（`normal`、`double` 或 `unconfirmed`），省略则沿用该段约定时段。已知和未知实际到账均直接保留。

团员填写业务日期，可为同一份额添加普通期、双倍期和实际时段待核对的明细。「我的日报」的实际时段默认选中「待核对」，提交时记为 `unconfirmed`。按次 `giftProgress` 的 `deliveredGiftTimes`、`remainingGiftTimes`、`observedGiftTimes`、`excessGiftTimes` 及 `shares` 按本人净份额汇总。`segments` 返回本人各段的 `quotePeriod`、`unitPriceCents`、进度、分期实绩及待结依据。全单已送和剩余分列为 `orderDeliveredGiftTimes` 和 `orderRemainingGiftTimes`，建单预计到账见 `estimatedReceivedHearts`。份额的 `claimObservedReceivedHearts` 是接单时的单次观察值。派单人从本单按次分工查看各份额已送次数并改派剩余。

同一订单、承接人、执行号与业务日只接受一份首报或补报。原请求可按相同标识和内容重试。另用新标识重复同日、重用标识修改内容或基于过期版本更正时，返回 HTTP 409。待写记录通过订单履约版本与改派互斥，单节点 MongoDB 支持写入及恢复。

## 派单监督与客户交付进度

团员端进入「派单准备 → 履约监督」。在「履约异常队列」选择一个已结束的业务日，系统以该日期及之前的有效日报核对。每段分别展示单价、约定次数、日量、执行窗口、已领、未领及已送。派单人可展开团员，再展开具体份额。按改派后的净日计划区分漏报、零送已报、部分不足、正常及尚未到核对日。份额过期后仍未送的次数单列，完整改派的份额保留原窗口及记录。团员自己的日历排期独立保存。补报和未结单日报更正以最新有效版本实时计入。

| 请求 | 用途 |
| --- | --- |
| `GET /api/employee/club/orders/fulfillment-exceptions?through=YYYY-MM-DD` | 当单派单人查本人异常队列。可用 `after`、`limit` 和 `source`。 |
| `GET /api/employee/club/orders/:orderId/fulfillment` | 当单派单人查看订单、段、团员及具体份额。传 `through` 时以该业务日为截止，包含当日。未选择核对日时展示当前累计和已填日报。 |
| `GET /api/client/orders` 与 `GET /api/client/orders/:orderId` | 老板查看归属本人的直接派单和客户端订单。老板视图仅返回客户侧金额及履约汇总。 |

按次的 `deliveryProgress.priceUnit` 为 `gift_times`。老板在「我的订单」和订单详情核对整单及各段的约定、已送和剩余次数。建单预计实收与接单时登记的实际实收、日报实际到账分别展示。接单实收使用匿名、去重的观察值及未知数。日报累计取各有效日报实际到账，所有明细都已知时给出合计，存在未知时另给已知小计及未知明细数。明确零到账显示 0。履约送完和派单人确认结单各有状态，`closedAt` 取已记录的结单事实。结单后保留日报历史，关闭普通补报与更正写入。

### 按实际时段拆分实绩

本人日报、派单监督及老板交付进度的 `periods` 按各有效日报明细的实际 `period` 分组。报价期别和建单预计均保留。同一段、账号和业务日可有多个实际期别。派单监督按全单、报价段、成员和净份额查看。老板按本人订单和报价段查看分期，成员、账号和内部报酬由团员端按权限核对。

| 字段 | 口径 |
| --- | --- |
| `observedGiftTimes` / `deliveredGiftTimes` | 实报次数及计入约定的次数。按净份额限制，超出部分见 `excessGiftTimes`。一份额跨实际时段且超出净份额时，如需决定实报次数在哪个时段计入，相关时段的计入次数与金额为 `null`，待业务核对。 |
| `estimatedDeliveredHearts` | 按已实报赠送次数和实际期别估算，普通期每次 1 颗、双倍期每次 2 颗。包含实际时段待核对的正赠送次数时，相应合计为 `null`，已知期别仍各自显示预计。 |
| `actualReceivedHearts` | 日报实收汇总。存在未知明细时为 `null`，同时返回 `knownReceivedHearts`、`knownReceivedLines`、`unknownReceivedLines`，明确到账 0 颗计入已知。接单时的观察值单列。 |
| `heartAmountCents` / `pendingCompensation` | 已计入约定的次数乘实际所属计价段的单价。团员可查看本人按首段锁定的每次派抽和团抽计算的待结报酬。无约定的超额次数不计费、不计酬。 |
| `periodOnlyDifferenceCents` | 老板和派单人核对仅改变到账倍率的价差，值为 0。赠送次数和各段单价沿用原约定，原报价及已登记实收可分别查阅。日报及分期汇总只更新履约记录，补款、退款和入账有各自的业务入口。 |

### 已付款订单的剩余次数改价

本单派单人从「派单准备 → 履约监督 → 已付款订单改价」选择还有未送付费次数的段，填写涉及次数、目标时段和目标每次单价。试算列出首次确认报价、登记实收、已送、实际到账、剩余、拟总价和价差。同单价跨普通期和双倍期的差额为零。已付款的剩余次数不办理降价。

提交正向提价须填写原因。协商和待补款期间暂停领取、改派、续段和新送心。老板从「我的订单 → 查看订单详情」确认同意补差，或拒绝补差并停送。派单人可另行登记已经发生的线下协商，写明实际发生时间及可追溯依据，详情标为派单人线下登记。

过去的补报或更正改变已确认的付费履约次数时，待答复或待实补的方案失效，原方案和老板已作出的答复仍可查。订单继续暂停新的送心，派单人可用「重新试算改价」提交新方案供老板答复，或用「按现有约定恢复履约」结束已失效的方案。每次已实际到账的实补及相应价格段保留。

| 请求 | 数据 |
| --- | --- |
| `POST /api/employee/club/orders/:orderId/fulfillment/price-preview` | `{ quoteSegment, giftTimes, targetPeriod, targetUnitPriceCents }`。段号从 1 开始，时段为 `normal` 或 `double`。只有可以发起的试算返回 `adjustmentReview.version`。 |
| `POST /api/employee/club/orders/:orderId/price-adjustment` | 原试算字段，另带 `expectedVersion`、`reason` 和 `requestId`。 |
| `POST /api/client/orders/:orderId/price-adjustment/decision` | `{ adjustmentId, expectedRevision, decision, requestId }`，答复为 `accept` 或 `decline`。团员端同路径登记线下答复时另填 `occurredAt` 和 `evidence`。 |
| `POST /api/employee/club/orders/:orderId/price-adjustment/payments` | `{ adjustmentId, expectedRevision, kind, amountCents, occurredAt, requestId, reason? }`。实际补款用 `supplement`，实际退款用 `refund`。发生时间含时区，说明未填写时沿用改价原因。 |
| `POST /api/employee/club/orders/:orderId/price-adjustment/resume` | `{ adjustmentId, expectedRevision, requestId }`。派单人结束 `needs_requote` 方案，恢复尚待履约的现有段。 |

首版在线下收退款，由派单人在款项实际到账或退回后登记。同意本身不增加实收。派单人核对实际收到全额补款并登记后，涉及的未送次数进入新段，履约总量不变。继续履约时使用该段和对应份额。同一送心号当日已有日报时，可保留旧段明细并在同一日报的更正版本中追加实际续送的新段明细。已送记录、首次报价、实收、每次优惠的锁定分摊和抽成保留，后续改价只作用于当时剩余的付费次数。

拒绝补差停止后续送心。应退按最新有效日报、历次已付款价格和锁定分摊核算整单未送的付费次数。促销赠送对应零退款。实际退款可分次登记，每次以登记时的应退额核对。过去的履约补报或更正可改变应退，既有实退款和登记时应退额继续可查。已退超过最新应退时，两端展示差额，净实收仍按实际收退款计算。主动退单与券返还见 P1-14，入账见 P1-17。

改价及收退款写入使用 UUID v4。相同标识和内容可安全重试，旧版本、重复使用标识提交不同内容及相冲突的答复返回 HTTP 409。派单履约监督返回 `priceAdjustment` 和 `priceAdjustmentHistory`，老板从自己订单的 `deliveryProgress` 读取。派单人可用履约监督中的现有履约核对查看已送爱心款和报酬、派抽、团抽。

### 未结单时追加计价段

已正式派发的按次订单在可继续履约且尚未结单时，老板可在订单详情点「在原单追加计价段」，包括已完成原约定次数的订单。老板填写新段的期别、总次数、每日日量和起止日。当单派单人在「派单准备 → 报价与派发规则 → 续段处理」为该申请填写每次单价。老板确认报价后，派单人登记实际收到的全额款和收款时间。核款后，新段的次数进入全单约定和派单分工。派单人在同页「按次派发与分工」使用报价执行窗口配置公开领取或定向承接。各段独立计价，整单沿用首段每次派抽和团抽。原单的报价、原实收、历次续段报价和实收分别保留。老板可核对初次订购、当前约定次数、原报价和原收款。累计已登记收款合计原收款与已核款续段。

下表路径相对于对应端的 `/api/client/orders/:orderId` 或 `/api/employee/club/orders/:orderId`。写入所用的 `requestId` 为 UUID v4。

| 端 | 请求 | 载荷 |
| --- | --- | --- |
| 客户端 | `POST /continuation-requests` | `{ requestId, period, paidGiftTimes, dailyGiftTimes, startDate, endDate }` |
| 团员端 | `POST /continuation-quotes` | `{ requestId, customerRequestId?, segment: { period, paidGiftTimes, dailyGiftTimes, unitPriceCents }, window? }`。有老板申请时沿用申请的期别、次数、日量及窗口。 |
| 团员端 | `PATCH /continuation-quotes/:quoteId/window` | 对已有的无窗口报价登记 `{ startDate, endDate }`，可按原日期重试。 |
| 客户端 | `POST /continuation-quotes/:quoteId/acceptance` | 本单老板提交 `{ requestId }`，确认明确的续段报价。 |
| 团员端 | `POST /continuation-quotes/:quoteId/receipt` | `{ requestId, receivedAmountCents, receivedAt }`。实收必须与该笔续段报价相符，时间须带时区。返回激活的、从 0 开始的 `segmentIndex`。 |

续段报价、确认与实收可按相同提交标识及内容重试。确认报价和核款使用同一订单的续段版本，避免重复激活。已核款的新段采用既有的按次派发与领取接口。[结单与续单](heart-delivery.md#结单与续单)

### 按次结算

管理端「俱乐部管理 → 结算核对」要求本团有效成员持有 `CLUB_FINANCE_READ`。团员端「我的承接 → 承接详情 → 本人送心结算」提供本人各段预计和实绩报酬，「派单准备 → 本人派单结算」提供本单派单人的预计和实际派抽、兑现的个人让利及净额。客户从「我的订单 → 查看订单详情」核对本单状态和客户侧现金收退。

| 请求 | 用途 |
| --- | --- |
| `GET /api/admin/club/settlements` | 分页核对本团结算订单和当前状态。 |
| `GET /api/admin/club/orders/:orderId/settlement` | 核对原报价、首段抽成规则、各段和各人预计与实绩、款项、当前和上一份计算单。 |
| `GET /api/admin/club/orders/:orderId/settlement/calculations/:calculationId` | 读取当时保存的报价、款项、有效日报及原版本。 |
| `GET /api/employee/club/orders/:orderId/settlement` | 有效团队成员读取本人在本单对应的送心或派单金额。 |
| `GET /api/client/orders/:orderId` | 正式按次结算返回本人的 `settlement.status`、`settlement.cash`，有停送时附本人可查的 `settlement.termination`。 |

按次结算以 `priceUnit: gift_times` 标识。预计按所有已约定计价段和净承接份额计算，实绩按最新有效日报计算。改派时扣除移出的份额，同一团员的多份额合并，自派自接时分别列派单净额和本人送心报酬。派抽和团抽沿用发布时锁定的每次金额，实际到账颗数独立展示。误送超出净份额的次数留作实绩，计酬上限沿用约定份额；同业务日的普通期和双倍期分别保留明细。报价和结算均按整分核算。

`planned` 和 `totals` 分列派抽原额、个人让利、派单人净额、团抽原额、平台优惠、促销赠送成本、团费净额与送心报酬。部分履约按原报价锁定的整分兑现优惠；已付款的续段和已实补的改价保留各自的价格与收款记录。`cash` 分列原实收、续段实收、改价实补、应退、实退、待退、超退和净实收。

履约完成或已停送、有效实绩和账款核平后，状态为 `ready_to_close`（待结单）。仍有送心义务时状态为 `in_progress`（履约中）。退款未核平、已确认的续段未实收、改价未生效或依据存在差异时显示 `review_required`（待核对）。V6 计算单按完整有效依据生成编号，同一依据并发查询复用记录。有效补报或更正更新当前计算依据，历史计算单保留。查询计算单与生成快照不改写结单状态或余额。

结算纳入已登记的续段收款、实补、已确认拒补及实退。未确认的改价与续段保留查阅，按阶段显示。

普通停送与拒补停送共用 P1-14 的原报价、有效实绩和退款读模型。已收款但尚未派发的停送也进入授权财务列表和本人派单结算，实退核平后生成零实绩计算单。报价仍按原确认依据，派发前的预计抽成与报酬显示未锁定。派单人和授权财务可以核对退款登记人、原因和依据，客户仅可查看本人订单的实退金额、发生时间和公开停送说明。普通停送与实退的写入由 P1-14 提供。

额外客户补偿和责任扣款由结算查询读取同团同单的 `club_financial_adjustments`。一笔责任扣款用一条 `member_penalty` 记录，`status` 同时描述申请和生效状态。额外团费补偿使用 `customer_compensation`。财务可查申请与决议依据。只有 `approved` 记录计入分配，批准的补偿转为应退，按实际退款记录进入实退。待确认或驳回的记录不改变分配、待结状态或最终计算单。全团罚款按无 `orderId` 的独立记录处理。关联订单的责任扣款归入团费，目标团员有本人送心报酬时另列扣款及净额。对本单无派发或承接权限的责任团员，订单依然不可见。

写入方使用 `clubId` 和关联订单的 MongoDB `orderId`，保存整分金额、原因、申请或发布人、决定人和发生时间。额外补偿的每笔实退保存独立请求标识、整分金额、实际发生与登记时间、登记人。`revision` 从 1 起，每次状态或退款变更原子递增。P1-15 提供调整申请、审批、实退登记和调整流水。结单确认及送心报酬、派抽和团抽入账由 P1-17 接续。

通知由已持久化的 `member_penalty` 生效记录驱动。费用业务可在成功写入后调用 `AppNotificationService.publishApprovedPenalty(penaltyId)`，后台也会定期补齐未处理记录。通知与结算都要求已批准、有效的决定人与时间、正整数分、有效的被罚款人与提交人，并且没有退款记录。决定之后的职务变化不影响原决定。事件键为 `club.penalty.approved:<罚款ID>`，只向团员端的被罚款人和提交人各投递一次重要通知。核对字段 `notificationPublishedAt` 记录通知事件入库时间，沿用原罚款 `revision` 与结算依据。

### 罚款与额外补偿经办

| 请求 | 经办与数据 |
| --- | --- |
| `GET /api/admin/club/penalties` | 管理端团长、副团长或具备财务查看授权的账号读取本团罚款。`canPublish` 表示当前账号可发布。 |
| `POST /api/admin/club/penalties` | 管理端团长或副团长提交 `{ requestId, memberUserId, amountCents, reason, orderId? }`，发布人与提交人为同一账号。可关联已分配派单人且未取消、未结单的订单。 |
| `GET /api/employee/club/orders/:orderId/financial-adjustments` | 本单派单人查看各笔申请、决定和实退。`canRequest` 表示订单可申请额外补偿，`canRequestPenalty` 表示仍可申请关联罚款。 |
| `POST /api/employee/club/orders/:orderId/financial-adjustments` | 本单派单人提交 `{ requestId, kind, amountCents, reason }`。`member_penalty` 另填 `memberUserId`，`customer_compensation` 以订单老板为对象。 |
| `GET /api/employee/club/financial-adjustments` | 团长、副团长读取本团待确认调整。 |
| `PATCH /api/employee/club/financial-adjustments/:id/decision` | 团长、副团长提交 `{ expectedRevision, decision, reason? }`。决定为 `approved` 或 `rejected`。 |
| `POST /api/employee/club/orders/:orderId/financial-adjustments/:id/refunds` | 本单派单人登记获批补偿的实际退款，提交 `{ requestId, expectedRevision, amountCents, occurredAt, evidence? }`。实际时间带时区，介于首笔收款与当前时间之间。可分次退，合计不超过批准金额。 |
| `GET /api/employee/club/balance` | 本人已入账余额、流水和随结单扣记的本人罚款。 |
| `GET /api/admin/club/balance`、`GET /api/admin/club/balance/members/:userId` | 有财务授权的管理端账号核对团费或指定团员账户流水。 |

`requestId` 为 UUID v4。同一提交人重试相同申请或发布请求时返回同一记录，同一补偿实退以补偿 ID 和请求 ID 识别重试。决定与实退使用 `revision` 条件写入。批准或驳回的决定、实退金额和时间、登记人及选填凭据均随原调整记录保存。

独立罚款将有效决定作为本人借记与团费贷记的共同凭据，两项使用相同流水事件键 `club.penalty:<罚款ID>`。订单罚款生效后纳入核算，实际余额在结单时变化。结单写入方须在同一次 `club_orders` 原子更新中写入 `closedAt` 和 `settlementPenaltyIds`（本次核算冻结的本单生效罚款 ObjectId 数组）。`adjustmentPostings` 按确切 ID 与生效时间核对后生成个人借记和团费贷记。订单结单或取消后不再新增或批准该单的关联罚款，原生效操作可按原请求重试。团费补偿以每笔实退款为团费支出凭据，批准后的待退款进入订单应退，退款登记后进入实际流水。结单按扣罚前送心报酬入账，派抽、团抽、优惠与赠送成本按各自分录核算。已冻结罚款和已登记补偿由原记录提供入账依据。

## 本人承接与排期

团员端「我的承接」提供时间轴、列表、日历、表格和看板。手机端从「我的」进入，桌面也可从个人工作台的导航进入。五视图使用同一批本人承接和详情，未排期订单在时间轴与日历下方单列。派单人仍从「派单准备」查看整单分工。

- `GET /api/employee/club/orders?responsibility=executor` 返回本人承接列表。用 `limit` 指定页长，以 `nextCursor` 作为下一页的 `after`。
- `GET /api/employee/club/orders/:orderId/assignment` 返回本人持有的份额、对应执行号和排期。按次订单的 `giftProgress` 分列承接、履约和剩余次数，并单列有效日报的实际到账颗数。改派从原团员的份额中扣除相应次数。
- `PATCH /api/employee/club/orders/:orderId/personal-schedule` 接受 `startDate`、`endDate` 和 `expectedRevision`。日期是含首尾日的 `YYYY-MM-DD`，清空时两项均传 `null`。版本冲突返回 409，以最新排期重试。排期只对本人可见，保存时派发窗口、分工每日次数和计价段按原约定执行。

接单区与本人承接沿用相同的撤回历史权限。撤回后，已关联本人执行号的团员可以查阅承接历史。停用团员无法读取或调整排期。
