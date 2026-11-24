# MongoDB 初始化与版本迁移

从项目根目录将 `server/.env.example` 复制为 `server/.env`，设置 `DB_MONGO_CONNECTION`、随机生成的 `SESSION_SECRET` 和首次创建管理员使用的 `BOOTSTRAP_ADMIN_PASSWORD`。管理员用户名由 `BOOTSTRAP_ADMIN_USERNAME` 指定，默认是 `root`。生产运行也可以从进程环境或 `server/.env.production` 读取配置。

```sh
pnpm --filter @webapp-template/server migrate
```

也可以设置 `MIGRATE_ON_START=true`，由服务在监听 HTTP 前运行同一组迁移。首次创建管理员后可以移除 `BOOTSTRAP_ADMIN_PASSWORD`。

| 版本 | 行为 |
| --- | --- |
| v1 | 根据权限编码补齐模板权限，保留已有数据及其引用。 |
| v3 | 创建 `admin`、`employee`、`common` 三种角色。给具有旧 `SUPER_ADMIN` 角色的用户补上 `admin`，给其余尚无 Web 角色的账号补上 `common`。 |

旧库中的 v2 记录属于上游模板的历史迁移。更新后的系统保留这些历史记录。旧超级管理员若仍使用模板出厂密码，需要通过 `BOOTSTRAP_ADMIN_PASSWORD` 更换。迁移会解绑该预置账号上仍与上游示例值一致的邮箱、手机或 OpenID。旧员工和其他后台用户的访问范围由管理员在「系统管理 → 用户管理」分配。

`migrations` 集合按版本保存成功或失败状态、执行耗时和错误信息。修正连接配置、管理员密码或数据冲突后，重新执行同一个迁移命令即可。需要备查某一版时，可直接在 MongoDB 查看记录。

```js
db.migrations.find({}, { _id: 0 }).sort({ executed_at: 1 })
```
