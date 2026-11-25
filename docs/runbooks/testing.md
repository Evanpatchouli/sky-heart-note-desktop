# 测试与验收

在仓库根目录执行 `pnpm install --frozen-lockfile`，首次验证从 `pnpm build` 开始。共享包类型检查用 `pnpm --dir common typecheck`，管理端 lint 用 `pnpm --dir admin lint`。服务端的 `lint` 自带 `--fix`，单独检查可运行 `pnpm --dir server exec eslint "src/**/*.ts"`。

| 命令 | 覆盖 |
| --- | --- |
| `pnpm build` | 各工作区构建、前端 TypeScript 编译和三端 PWA 生成 |
| `pnpm test` | 服务端 Jest 和团员端待确认领取记录 |
| `pnpm test:pwa` | 已构建三端的安装元数据、离线页、缓存更新和通知路由 |
| `pnpm --dir server test:e2e` | HTTP 生产入口、跨端会话及俱乐部业务集成 |
| `pnpm --dir admin build:prototype` | 管理端设计原型的独立构建 |

HTTP 集成需要已构建的 `server/dist` 和本机可运行的 `mongod`。测试在临时目录和端口启动数据库及 API。若 `mongod` 不在 PATH，设置 `$env:MONGOD_BINARY` 为可执行文件的绝对路径。可运行 `pnpm --dir server exec node --test test/web-apps.e2e.mjs` 单独验证多端入口。

品牌、PWA 或工作区元数据变更至少核对构建、PWA 和多端 HTTP 测试。订单规则变更用[上下文索引](../context/README.md)定位测试，同步核对权限及历史订单分支。部署配置变更按照[发布检查](deployment.md#发布检查与回滚)校验 Compose。

## 真机验证

用 Android Chrome 及 iPhone/iPad 主屏幕应用验证三端安装、版本更新、断网恢复和账号隔离。开启设备提醒后核对目标端、切换账号及点击通知后的落点。[安装与设备提醒步骤](../../README.md#安装管理端团员端和客户端)
