# 送心手记

本仓库以 [webapp-template 的 main 提交 a6b1583](https://github.com/Evanpatchouli/webapp-template/tree/a6b158331a55a3c474f5ef7657522547b7d5f2c2) 为骨架，将原桌面员工端迁移为 Web 应用。四个前端共用 NestJS 服务。

| 包 | 用途 | 开发地址 | 准入角色 |
| --- | --- | --- | --- |
| admin | 管理用户与角色、查看登录记录 | http://localhost:5173 | admin |
| employee | 原员工端的送心订单、时间轴与分析 | http://localhost:5174 | employee、admin |
| client | Vite + React 客户端基础页 | http://localhost:5175 | common、employee、admin |
| site | Vite + React 官网基础页 | http://localhost:5176 | 公开 |
| server | 身份、授权和业务 API | http://localhost:8793/api | 各接口按端校验 |

## 本地启动

使用 Node.js 24 或更高版本、pnpm 10.30.0 和 MongoDB。先在仓库根目录准备依赖与环境文件。

```powershell
pnpm install --frozen-lockfile
pnpm --dir common build
Copy-Item server/.env.example server/.env
```

在 `server/.env` 中设置 MongoDB 连接、随机生成的 `SESSION_SECRET` 和首次创建管理员使用的 `BOOTSTRAP_ADMIN_PASSWORD`。保持 `MIGRATE_ON_START=true`，首次启动将创建角色与管理员，默认管理员账号是 `root`。已有模板数据库中的超级管理员会获得 `admin` 角色，其他旧账号保留原角色并按需补充 `common`。在客户端注册的账号初始角色为 `common`，管理员可在「系统管理 → 用户管理 → 更多 → 变更角色」中授权。

在独立终端分别运行需要的服务。开发时各前端通过 Vite 将 `/api` 代理到 `http://127.0.0.1:8793`，请使用表中的 localhost 地址访问。

```sh
pnpm dev:server
pnpm dev:admin
pnpm dev:employee
pnpm dev:client
pnpm dev:site
```

## 跨端登录与部署

1. 三端使用 `POST /api/user/login?type=account`，提交 `app`、`username`、`password` 和 `captcha`。图形验证码来自 `GET /api/captcha/login?app=目标端`。管理端原有的邮箱验证码登录需要配置 SMTP。
2. 登录成功后，本端保存自己的访问令牌。API 在浏览器设置当前端专用的 HttpOnly Cookie。访问另一个端时，`GET /api/user/login/candidates?app=目标端` 返回同一浏览器中有资格进入目标端的账号。
3. 用户点击某个候选账号后，目标端向同一登录接口发送 `type=shared` 和 `{ app, sourceApp, sourceUserId }`。服务端核验请求来源、源会话与当前角色，然后签发目标端的独立会话。退出当前端会撤销该端的访问与借用凭据。其他已登录的端保留自己的会话。

生产环境使用同站点下各自独立的 HTTPS 前端域名，例如 `admin.example.com`、`employee.example.com`、`client.example.com` 和 `www.example.com`。将各包构建时的 `VITE_APP_API_BASE_URL` 设为同一个完整地址，例如 `https://api.example.com/api`。在服务端将 `ADMIN_ORIGIN`、`EMPLOYEE_ORIGIN`、`CLIENT_ORIGIN` 和 `SITE_ORIGIN` 设为对应前端的完整 Origin，并设置 `NODE_ENV=production`。浏览器的借用凭据属于 API 主机，四个端的跨域请求通过显式来源列表校验。官网读取公开接口 `GET /api/site`。

## 员工数据与旧库导入

账户、授权与会话保存在 MongoDB。员工业务保留 SQLite 的记录 ID、送心号与预约关联、时间戳以及设置。服务端按 MongoDB 用户 ID 隔离数据，默认写入 `server/data/employee/`，可用 `EMPLOYEE_DATA_DIR` 指定持久卷。服务端与导入工具应使用相同配置和数据卷。

关闭旧桌面端，将其应用数据目录中的 `data.db` 备份至服务端可读的位置，再指定记录所属的 **MongoDB 用户 ID** 导入。

```sh
pnpm --dir server exec ts-node scripts/import-employee-db.ts <MongoDB用户ID> "<旧data.db的绝对路径>"
```

工具以只读方式打开源文件，并在目标库内用一个事务导入 `booking`、`songxinhao` 和 `kv`。重复导入内容相同的记录会跳过，发现相同 ID 或键对应不同内容会回滚本次导入。

员工端通过受保护的 `/api/employee/bookings` 和 `/api/employee/songxinhao` 操作业务数据。`/api/employee/workspace` 返回 Web 工作区入口，`/api/employee/settings` 提供旧 KV 设置的读取、写入与删除。`/api/employee/share` 提供共享状态，浏览器标签页通过 BroadcastChannel 收取更新通知。外链使用浏览器的链接导航。

## 验证

```sh
pnpm build
pnpm test
pnpm --dir server test:e2e
```

HTTP 集成测试需要本机可执行的 `mongod`，可通过 `MONGOD_BINARY` 指定路径。测试自行启动临时 MongoDB 实例并验证生产服务入口。
