# 本地开发

使用 Node.js 24 或更高版本、pnpm 10.30.0 和可连接的 MongoDB。Windows 使用 PowerShell 7。

```powershell
pnpm install --frozen-lockfile
pnpm --dir common build
Copy-Item server/.env.example server/.env
```

仅在首次配置时复制环境文件。按[服务端配置示例](../../server/.env.example)设置 `DB_MONGO_CONNECTION` 和随机的 `SESSION_SECRET`。空库首次启动启用 `MIGRATE_ON_START=true`，为默认管理员 `root` 设置 `BOOTSTRAP_ADMIN_PASSWORD`。邮箱登录需要 SMTP，系统推送需要 VAPID。

在独立终端按需启动服务。

| 命令 | 默认地址 |
| --- | --- |
| `pnpm dev:server` | http://localhost:8793/api |
| `pnpm dev:admin` | http://localhost:5173 |
| `pnpm dev:employee` | http://localhost:5174 |
| `pnpm dev:client` | http://localhost:5175 |
| `pnpm dev:site` | http://localhost:5176 |
| `pnpm dev:common` | 持续构建共享包 |

使用 `localhost` 访问前端以匹配默认 Origin。Vite 将 `/api` 转给 `127.0.0.1:8793`。调整端口或主机时同步检查 Vite 代理与四个 `*_ORIGIN`。

共享模块解析失败时先核对锁定依赖并重建 `common`。API 启动失败时看日志，检查环境文件位置、数据库连通性和会话密钥。启动后执行 `Invoke-RestMethod http://localhost:8793/api/site`，预期返回名称 `Sky Club`。需要走查派接单流程时，按[首次启用俱乐部运营](../../README.md#首次启用俱乐部运营)配置团长和测试成员。

原型的启动和联动见[设计评审](../design/README.md)及[管理端原型](../design/admin/README.md#启动与复现)。
