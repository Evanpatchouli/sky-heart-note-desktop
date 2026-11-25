# 部署与回滚

## 首次部署

使用 Linux、Git、Bash、Docker Compose v2.20.2 或更高版本。根 [Compose](../../docker-compose.yml) 构建四个 Nginx 静态站点和一个 NestJS 镜像，应用镜像记录 Git revision。新环境的 Compose 项目、默认 MongoDB 库名和业务数据库账号均为 `sky-club`。

从[根环境示例](../../.env.example)创建 `.env`，权限设为 `600`。配置 `SESSION_SECRET` 和首次建库的 `BOOTSTRAP_ADMIN_PASSWORD`。内置 MongoDB 使用 `COMPOSE_PROFILES=mongo`、`MONGO_ROOT_PASSWORD` 和 `DB_MONGO_PASSWORD`。外部 MongoDB 使用实际连接串、凭据和网络。配置前端构建时的 `VITE_APP_API_BASE_URL` 及四个 `*_ORIGIN`，生产应用通过同站点下的独立 HTTPS 域名访问。设备提醒的 VAPID 私钥仅配置在 API 环境。

```sh
docker compose config --quiet
./deploy-all.sh
docker compose ps
curl -fsS http://localhost:8793/api/site
```

使用内置 MongoDB 时依次启动 MongoDB、API 和前端。启用 `MIGRATE_ON_START=true` 时 API 在启动时迁移数据。空库启动后按[首次启用俱乐部运营](../../README.md#首次启用俱乐部运营)配置团长。

## 已有安装升级到 Sky Club

1. 先备份 MongoDB 和团员 SQLite 卷，记下当前 Git 版本、Compose 项目名、实际卷名和环境文件。用 `docker compose ls` 查询项目名，通过 `docker inspect <容器>` 的挂载记录确认卷和目标路径。
2. 根 Compose 已运行时，将 `COMPOSE_PROJECT_NAME` 设为原项目名以沿用现有容器、网络和默认命名卷。使用内置 MongoDB 时显式设置 `MONGO_DB_NAME` 和 `DB_MONGO_USERNAME` 为现有值。已设置 `DB_MONGO_CONNECTION` 或 `EMPLOYEE_VOLUME_NAME` 的部署沿用原配置。保留现有数据库凭据、会话密钥和前端 Origin。
3. 独立 API 原容器配置了自动重启。使用旧版本的 Compose 文件和原项目名执行 `docker compose -f server/docker-compose.yml down`，保留命名卷。切到根 Compose 时，将 `EMPLOYEE_VOLUME_NAME` 指向旧容器挂载在 `/app/server/data/employee` 的卷，沿用数据库和会话配置，再启动根 Compose。继续使用独立 API 时，沿用原 Compose 项目运行新版 `server/redeploy.sh`。新容器名为 `sky-club-server`。
4. Eotion 部署使用[覆盖文件](../../docker-compose.eotion.yml)。新代理可配置 `sky-club-api`（端口 8793）以及 `sky-club-admin`、`sky-club-employee`、`sky-club-client`、`sky-club-site`（端口 80）。原代理别名仍可继续使用。前端同源 `/api` 代理继续使用新旧 API 版本都支持的内部别名，允许分别更新前端和 API。
5. 若已保存的俱乐部名仍须更新，由有效团长在「账户菜单 → 俱乐部运营」将显示名改为 Sky Club。环境变量 `CLUB_NAME` 用于空库初始化。

## 发布检查与回滚

在仓库根目录运行 `docker compose --env-file .env.example config --quiet` 校验基础配置。Eotion 配置可用 `docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.eotion.yml config --quiet` 校验。实际发布时使用部署环境复查配置及数据卷。全量脚本拉取配置的上游并等待健康检查。固定版本使用 `DEPLOY_SKIP_PULL=1`，单端发布使用对应的 `deploy-*.sh`。修改公共 API 地址后全量构建四个前端。

上线后核对 `docker compose ps`、公网 HTTPS 域名、`GET /api/site` 的名称和三端登录。涉及业务时用测试账号走查对应订单流程，涉及 Web Push 时确认通知跳转。失败先查 `docker compose logs --tail=100 <服务>`。

回滚时使用上一可用版本和原部署配置运行 `DEPLOY_SKIP_PULL=1 ./deploy-all.sh`，再核对版本、数据卷和登录。独立 API Compose 使用同版本的 `server/redeploy.sh`，切回旧容器前先释放端口。涉及数据迁移时先确认旧版本能否读取迁移后数据。需要恢复时使用已核对的部署前备份，并保留迁移后的副本供比对。
