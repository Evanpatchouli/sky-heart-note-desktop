# 项目上下文索引

先按页面、角色、订单阶段或接口定位，再查对应的 controller、service、DTO 和测试。用当前实现和测试确认行为，用设计原型、路线图和 Git 历史补充背景。

| 领域 | 代码入口 | 验证入口 | 业务依据 |
| --- | --- | --- | --- |
| 登录、注册、跨端会话 | [认证模块](../../server/src/auth/)、[用户控制器](../../server/src/modules/user-module/user.controller.ts)、[共享登录](../../common/web-auth/) | [多端 HTTP 测试](../../server/test/web-apps.e2e.mjs) | [跨端登录](../../README.md#跨端登录与部署) |
| 订单、报价、优惠 | [俱乐部模块](../../server/src/modules/club/)、[报价规则](../../common/src/club-pricing.ts)、[客户端下单](../../client/src/new-order.tsx) | [订单](../../server/test/club-orders.e2e.mjs)、[优惠](../../server/test/club-promotions.e2e.mjs) | [业务细则](../heart-delivery.md) |
| 派单、领取、履约 | [团员派单](../../employee/src/views/club-dispatch/)、[领取](../../employee/src/views/gift-claims.tsx)、[履约服务](../../server/src/modules/club/club-gift-delivery.service.ts) | [按次派接单](../../server/test/club-gift-dispatch.e2e.mjs)、[履约监督](../../server/test/club-gift-supervision.e2e.mjs) | [订单 API](../club-orders.md) |
| 结算和售后 | [结算服务](../../server/src/modules/club/club-gift-settlement.service.ts)、[团员财务页](../../employee/src/views/club-financial/) | [结单](../../server/test/club-settlement-close.e2e.mjs)、[财务调整](../../server/test/club-financial-adjustments.e2e.mjs) | [按次结算](../club-orders.md#按次结算) |
| 通知和 PWA | [通知服务](../../server/src/modules/club/app-notification.service.ts)、[PWA 公共代码](../../common/pwa/) | [PWA](../../scripts/test-pwa.mjs)、[Web Push](../../server/test/club-dispatch-push.e2e.mjs) | [通知协议](../club-orders.md#三端通知与设备提醒) |
| 个人旧库 | [团员数据模块](../../server/src/modules/employee/)、[导入脚本](../../server/scripts/import-employee-db.ts) | [SQLite 测试](../../server/src/modules/employee/employee.spec.ts) | [旧库核对](../legacy-club-orders-migration.md) |
| 部署 | [根 Compose](../../docker-compose.yml)、[部署脚本](../../deploy/redeploy.sh) | [发布检查](../runbooks/deployment.md#发布检查与回滚) | [环境变量示例](../../.env.example) |

用 `git log -- <路径>` 查找与实现一起落地的决策。使用语义索引时，引用前核对当前提交、源码路径和符号。
