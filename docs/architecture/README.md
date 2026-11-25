# Sky Club 架构

| 工作区 | 入口和职责 |
| --- | --- |
| 管理端 | [admin/src](../../admin/src/) 管理用户和角色、抽成规则、平台优惠、罚款与财务核对 |
| 团员端 | [employee/src](../../employee/src/) 处理派单、领取、承接排期、履约日报和结单 |
| 客户端 | [client/src](../../client/src/) 提供注册、下单、订单进度、改价确认和结算查询 |
| 官网 | [site/src/main.tsx](../../site/src/main.tsx) 调用公开接口 `GET /api/site` 读取品牌名 |
| API | [server/src/main.ts](../../server/src/main.ts) 启动 NestJS 并统一挂载 `/api`。[应用模块](../../server/src/app.module.ts) 组合账户、认证、俱乐部和团员工作区 |
| 共享包 | [common](../../common/) 提供业务类型、计算规则以及前端共用的认证、移动导航和 PWA 模块。官网可独立构建，另外三个前端与 API 依赖共享包 |

本地由 Vite 代理 `/api`。根 Compose 通过 Nginx 提供四个静态前端，由一个 NestJS API 服务处理业务。三端分别签发会话。跨端借用由 API 检查来源、源会话和目标端角色，俱乐部动作另行校验成员资格、订单职责和权限。[登录协议](../../README.md#跨端登录与部署) · [运营权限](../club-orders.md#俱乐部运营权限)

俱乐部订单从客户端提交或团员端直接创建，经派发、领取、履约、结单及必要的售后处理。新送心订单按赠送次数定价和分配，实际到账颗数另行记录。服务端兼容历史按颗订单协议。[订单 API](../club-orders.md)

MongoDB 保存账户、权限、会话、俱乐部订单和结算流水。既有个人预约、送心号和设置写入按四位用户 ID 隔离的 SQLite 文件，由[团员工作区模块](../../server/src/modules/employee/)管理。Compose 分别挂载两类数据。PWA 缓存公开构建资源，业务读写经 API 实时完成。[三端通知与设备提醒](../club-orders.md#三端通知与设备提醒)
