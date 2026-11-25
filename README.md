# Sky Club

本仓库以 [webapp-template 的 main 提交 a6b1583](https://github.com/Evanpatchouli/webapp-template/tree/a6b158331a55a3c474f5ef7657522547b7d5f2c2) 为骨架，将原桌面团员端迁移为 Web 应用。四个前端共用 NestJS 服务。

项目标识为 `sky-club`。[文档地图](docs/README.md)按架构、规格、运行手册及任务计划组织项目资料。俱乐部平台的需求与计划见[业务说明](docs/club-business.md)、[送心业务细则](docs/heart-delivery.md)、[路线图](docs/roadmap.md)和[开发任务清单](docs/todo.md)。

客户可在「下单」和「我的订单」切换送心、代跑和陪玩。团员从派单、接单和本人承接入口办理，财务从管理端「结算核对」按业务线追查收退款与余额分录。本轮代跑和陪玩的规则来自委托模拟的[代跑样单](docs/specs/daily-run.md)和[陪玩样单](docs/specs/companionship.md)。

三端的[设计评审入口](docs/design/README.md)包含可联动的 P1 交互原型、视觉规范及手机、Pad 和桌面预览。[管理端原型](docs/design/admin/README.md)直接复用现有后台布局与 Ant Design 组件。

| 包 | 用途 | 开发地址 | 准入角色 |
| --- | --- | --- | --- |
| admin | 用户与角色、俱乐部规则、财务与罚款 | http://localhost:5173 | admin |
| employee | 派单、承接、排期、履约与结单 | http://localhost:5174 | employee、admin |
| client | 注册、下单、订单进度、改价确认与结算 | http://localhost:5175 | common、employee、admin |
| site | 公开官网 | http://localhost:5176 | 公开 |
| server | 身份、授权和业务 API | http://localhost:8793/api | 各接口按端校验 |

## 本地启动

使用 Node.js 24 或更高版本、pnpm 10.30.0 和 MongoDB。先在仓库根目录准备依赖与环境文件。

```powershell
pnpm install --frozen-lockfile
pnpm --dir common build
Copy-Item server/.env.example server/.env
```

在 `server/.env` 中设置 MongoDB 连接、随机生成的 `SESSION_SECRET` 和首次创建管理员使用的 `BOOTSTRAP_ADMIN_PASSWORD`。保持 `MIGRATE_ON_START=true`，使用空数据库启动，系统将创建角色与管理员，默认管理员账号是 `root`。服务端为管理员和其他新账号随机分配四位用户 ID，每位取自数字 0–9 和大写字母 A–Z，保留前导零。在客户端注册的账号初始角色为 `common`，管理员可在「系统管理 → 用户管理 → 更多 → 变更角色」中授权。用户列表展示昵称和短 ID，也可直接按短 ID 查询。

在独立终端分别运行需要的服务。开发时各前端通过 Vite 将 `/api` 代理到 `http://127.0.0.1:8793`，请使用表中的 localhost 地址访问。

```sh
pnpm dev:server
pnpm dev:admin
pnpm dev:employee
pnpm dev:client
pnpm dev:site
```

## 首次启用俱乐部运营

API 从空库启动时创建本团，初始名称取 `CLUB_NAME`，默认「Sky Club」。现有库保留已保存的名称。先让拟任团长拥有一个可登录团员端的启用账号。可使用初始化的 `root`，也可让该用户从客户端注册，再由平台管理员授予 `employee` 角色。请核对账号的四位用户 ID。

在与 API 使用相同 MongoDB 配置的可信部署环境指定首位团长。将示例中的 `00A1` 换成已核对的 ID。

```powershell
pnpm --dir server build
pnpm --dir server club:configure init-leader 00A1
```

Docker 部署使用 `docker compose exec server node dist/src/commands/club.js init-leader 00A1`。同一账号重复执行可核对初始化，另一账号会被拒绝。

团长登录团员端，从右上角「账户菜单 → 俱乐部运营」修改本团名称、加入已有团员账号并授予或收回运营权限。有效团员可在「派单准备」生成入团邀请。客户打开客户端「下单」即可提交本团订单。[俱乐部运营 API](docs/club-orders.md#俱乐部运营权限)

## 安装管理端、团员端和客户端

使用各端自己的 HTTPS 地址，先联网打开一次。Android 在 Chrome 菜单选择「安装应用」或「添加到主屏幕」。iPhone 或 iPad 在 Safari 的共享菜单选择「添加到主屏幕」。如果出现「作为 Web App 打开」选项，请保持开启。三个入口的纸飞机分别使用深蓝、靛蓝和绿色，可从主屏幕分别启动。

在电脑上调试安装和更新，可在 `pnpm build` 后按需用 `pnpm --dir admin preview`、`pnpm --dir employee preview` 或 `pnpm --dir client preview` 运行构建产物，并使用对应的 localhost 地址。真机请用配置好三端 Origin 和 API 的 HTTPS 测试环境。

在 Android 手机及 iPhone/iPad 上分别执行以下步骤。

1. 安装三端并点击各自图标。确认进入对应的独立应用窗口，再用有权限的测试账号登录。
2. 保留未提交的表单，向同一测试地址部署第二版。切回应用等待更新提示，确认输入仍在。处理完表单后关闭此端所有窗口和标签页，再从图标打开，确认进入新版。其他两端可以继续使用。
3. 保持页面打开并断网，确认页面提示网络中断，业务提交没有成功提示。完全关闭后，从图标再次打开应显示「当前无法连接」。恢复网络后点「重试」，核对服务端记录，再按需重试未确认的操作。
4. 用测试账号 A 在团员端创建一笔可识别的预约，退出后用账号 B 登录。核对 B 的列表，从应用图标重开后再次核对。管理端和客户端也分别用两名有权限的账号退出、登录并核对身份。

Service Worker 按版本缓存公开构建资源。业务数据和提交请求由 API 实时处理。断网期间保持页面打开时，先前已加载的数据可能仍在屏幕上，恢复网络后请刷新相应列表核对最新状态。

### 三端设备提醒

从 HTTPS 管理端、团员端或客户端打开「通知」，点「开启系统提醒」并允许通知。团员端的开关也适用于接单提醒。iPhone 或 iPad 须先将该端添加到主屏幕，再从图标打开。每个端和每台设备分别开启，退出或切换登录后需为当前会话重新开启。断网时关闭提醒会尝试取消浏览器订阅，并在该端恢复在线后补送解绑请求。普通及重要站内通知可直接在铃铛中查看。

部署人员可在可信环境运行 `pnpm --dir server exec web-push generate-vapid-keys --json` 创建一次 VAPID 密钥，为所有 API 实例配置相同的 `WEB_PUSH_VAPID_PUBLIC_KEY`、`WEB_PUSH_VAPID_PRIVATE_KEY` 和 `WEB_PUSH_VAPID_SUBJECT`。联系地址使用实际的 `mailto:` 或 HTTPS URL。直接运行 API 时配置 `server/.env`，根 Compose 使用根 `.env` 后重新部署 API。独立 Compose 使用其挂载的 `server/.env.production`。私钥仅存于 API 的环境配置。三项留空或配置不匹配时仍可发布派单并收到站内通知。更换密钥后，原设备需要重新开启。

API 只连接受信的 HTTPS 推送网关。默认接受 Chrome、Firefox 和 Safari 当前常用的网关 Origin。自管网关可通过 `WEB_PUSH_ALLOWED_ORIGINS` 添加逗号分隔的精确 HTTPS Origin，连接时使用公开 DNS 地址和有效的 TLS 证书。[订阅 API 与消息协议](docs/club-orders.md#三端通知与设备提醒)

## Docker 部署与重新部署

在 Linux 部署机上准备 Git、Bash 和 Docker Compose v2.20.2 或更高版本。根目录的 `docker-compose.yml` 编排四个 Nginx 前端、NestJS API 和可选的 MongoDB。容器重建后，团员的 SQLite 文件和 MongoDB 数据分别保存在命名卷中。

**首次启动**时复制配置文件，填写四个独立的随机值，再运行全量脚本。日常更新运行 `./deploy-all.sh`。发布检查见[部署手册](docs/runbooks/deployment.md#发布检查与回滚)。

```sh
cp .env.example .env
chmod 600 .env
# 在 .env 中填写 SESSION_SECRET、BOOTSTRAP_ADMIN_PASSWORD、MONGO_ROOT_PASSWORD、DB_MONGO_PASSWORD
./deploy-all.sh
```

示例配置通过 `COMPOSE_PROFILES=mongo` 启用内置 MongoDB。首次初始化时会为 API 创建仅对业务数据库有读写权限的账号。后续部署沿用现有数据库账号和数据卷；修改数据库密码时也要同步更新 MongoDB 中的凭据。MongoDB 仅在容器网络提供服务。

| 部署范围 | 仓库根目录命令 | 默认宿主机地址 |
| --- | --- | --- |
| 所有已启用的服务 | `./deploy-all.sh` | |
| 管理端 | `./deploy-admin.sh` | `http://localhost:5173` |
| 团员端 | `./deploy-employee.sh` | `http://localhost:5174` |
| 客户端 | `./deploy-client.sh` | `http://localhost:5175` |
| 官网 | `./deploy-site.sh` | `http://localhost:5176` |
| API | `./deploy-server.sh` | `http://localhost:8793/api` |
| 内置 MongoDB | `./deploy-mongo.sh` | 仅启用 `mongo` profile 时适用 |

脚本从当前分支配置的上游执行 `git pull --ff-only`，构建镜像并等待所选服务健康。尚未配置上游的分支直接部署当前检出，固定版本或离线重部署可使用 `DEPLOY_SKIP_PULL=1 ./deploy-all.sh`（镜像及构建依赖需已缓存）。独立脚本仅重建所选服务；例如重新部署团员端时，其余三个前端、API 和数据库继续运行。部署失败时脚本返回非零状态并打印容器状态及日志。

默认端口均绑定宿主机回环地址，可在根 `.env` 中用 `ADMIN_PORT`、`EMPLOYEE_PORT`、`CLIENT_PORT`、`SITE_PORT`、`SERVER_PORT` 调整。四个前端在构建时读取 `VITE_APP_API_BASE_URL`。更换公共 API 地址后，请运行全量部署以更新四个静态站点。

### 接入 Eotion 使用的生产网络

已有边缘 Nginx 和 MongoDB 的 Linux 主机可以在根 `.env` 中采用以下配置。将域名、连接串和凭据替换为实际部署值。

```dotenv
COMPOSE_PROFILES=
COMPOSE_FILE=docker-compose.yml:docker-compose.eotion.yml
DB_MONGO_CONNECTION=mongodb://mongodb:27017/sky-club
DB_MONGO_USERNAME=sky-club
VITE_APP_API_BASE_URL=https://api.example.com/api
ADMIN_ORIGIN=https://admin.example.com
EMPLOYEE_ORIGIN=https://employee.example.com
CLIENT_ORIGIN=https://client.example.com
SITE_ORIGIN=https://www.example.com
```

服务端会加入已有的 `mongo` 网络，API 与四个前端会加入已有的 `public-web` 网络。这两个外部网络可通过 `MONGO_NETWORK`、`PUBLIC_WEB_NETWORK` 更名。边缘 Nginx 终止 HTTPS，并将上述五个域名分别转发到 `sky-club-api:8793`、`sky-club-admin:80`、`sky-club-employee:80`、`sky-club-client:80`、`sky-club-site:80`。三个登录端共享同一个 HTTPS API 主机及其授权 Cookie。

## 跨端登录与部署

1. 三端使用 `POST /api/user/login?type=account`，提交 `app`、`username`、`password` 和 `captcha`。图形验证码来自 `GET /api/captcha/login?app=目标端`。管理端原有的邮箱验证码登录需要配置 SMTP。
2. 登录成功后，本端保存自己的访问令牌。API 在浏览器设置当前端专用的 HttpOnly Cookie。访问另一个端时，`GET /api/user/login/candidates?app=目标端` 返回同一浏览器中有资格进入目标端的账号。
3. 用户点击某个候选账号后，目标端向同一登录接口发送 `type=shared` 和 `{ app, sourceApp, sourceUserId }`。服务端核验请求来源、源会话与当前角色，然后签发目标端的独立会话。退出当前端会撤销该端的访问与借用凭据。其他已登录的端保留自己的会话。

生产环境使用同站点下各自独立的 HTTPS 前端域名，例如 `admin.example.com`、`employee.example.com`、`client.example.com` 和 `www.example.com`。将各包构建时的 `VITE_APP_API_BASE_URL` 设为同一个完整地址，例如 `https://api.example.com/api`。在服务端将 `ADMIN_ORIGIN`、`EMPLOYEE_ORIGIN`、`CLIENT_ORIGIN` 和 `SITE_ORIGIN` 设为对应前端的完整 Origin，并设置 `NODE_ENV=production`。浏览器的借用凭据属于 API 主机，四个端的跨域请求通过显式来源列表校验。官网读取公开接口 `GET /api/site`。

## 团员数据与旧库导入

账户、授权与会话保存在 MongoDB。团员业务保留 SQLite 的记录 ID、送心号与预约关联、时间戳以及设置。服务端按四位用户 ID 隔离数据，例如账号 `00A1` 对应 `server/data/employee/user-00A1.db`，可用 `EMPLOYEE_DATA_DIR` 指定持久卷。服务端与导入工具应使用相同配置和数据卷。

关闭旧桌面端，将其应用数据目录中的 `data.db` 备份至服务端可读的位置，再指定记录所属的 **四位用户 ID** 导入。

```sh
pnpm --dir server exec ts-node scripts/import-employee-db.ts <四位用户ID> "<旧data.db的绝对路径>"
```

工具以只读方式打开源文件，并在目标库内用一个事务导入 `booking`、`songxinhao` 和 `kv`。重复导入内容相同的记录会跳过，发现相同 ID 或键对应不同内容会回滚本次导入。

团员端通过受保护的 `/api/employee/bookings` 和 `/api/employee/songxinhao` 操作业务数据。`/api/employee/workspace` 返回 Web 工作区入口，`/api/employee/settings` 提供旧 KV 设置的读取、写入与删除。`/api/employee/share` 提供共享状态，浏览器标签页通过 BroadcastChannel 收取更新通知。外链使用浏览器的链接导航。

## 验证

```sh
pnpm build
pnpm test
pnpm test:pwa
pnpm --dir server test:e2e
```

HTTP 集成测试需要本机可执行的 `mongod`，可通过 `MONGOD_BINARY` 指定路径。测试自行启动临时 MongoDB 实例并验证生产服务入口。
