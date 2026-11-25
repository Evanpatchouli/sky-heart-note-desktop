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

## 2026-11-26 模拟设备验收

本轮使用隔离的测试账号、临时 MongoDB 和生产构建。设备验收按委托采用模拟环境。正式发布前仍需在实际 Android 手机和 iPhone/iPad 核对主屏幕图标、独立启动及系统通知表现。

| 环境 | 已验证 |
| --- | --- |
| Windows Chrome 157，独立测试配置 | 管理、团员、客户端分别安装并从应用窗口启动，窗口的 `display-mode` 为 `standalone`。发布下一版 Worker 后，旧窗口收到更新提示。关闭该端全部窗口、重新打开，新的静态缓存生效，旧缓存移除。三端各切换一次真实测试账号，服务端返回新账号，推送绑定随之切换，离线缓存中无 API 响应。 |
| Android 16 模拟器，Chrome 134 | 三端安装清单均通过浏览器安装检查。三端「添加到主屏幕」均出现对应的安装操作。断开测试站点后，三端显示各自离线页，恢复站点后可重新加载。模拟环境未确认 Android 系统生成 WebAPK。 |
| Playwright WebKit 26.5，iPhone 13、iPad Pro 11 配置 | 两类设备配置各走通三端清单读取、Service Worker 激活、服务中断时离线页及恢复访问。iOS/iPadOS 主屏幕安装及系统锁屏需用 Apple 设备复验。 |

**三端触控。** 管理端在手机 390×844 和两种 Pad 方向打开导航、结算清单及账单依据。团员端在 768×1024 调整本人排期、提交 10 次到账 9 颗的日报，并切换五种承接视图核对，原派接窗口保留。1024×768 横屏保存 10 元报价并领取 20 次。客户端在 820×1180、1180×820 提交 12 次订单，按来源查回详情，核对另一单从零履约到 50 次、到账 50 颗直至结单。手机窗口模拟软键盘收起底栏后仍可提交。桌面使用键盘与鼠标回归导航、下单、订单详情及视图切换。
