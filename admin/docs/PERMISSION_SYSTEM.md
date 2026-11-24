# 管理端登录与权限

管理端使用 `app=admin` 登录。服务端对密码登录、跨端借用和每个受保护的请求检查账号是否启用、是否仍有 `admin` 角色，以及访问令牌属于哪个端。管理员可在「系统管理 → 用户管理」变更用户角色；端与角色的完整对应关系见[项目说明](../../README.md)。

刷新页面时，`src/App.tsx` 使用本端保存的 token 调用 `GET /api/user/session?app=admin`。验证成功后再将 `roles` 和 `permissions` 写入内存中的 Zustand store 并渲染管理页面。选择其他端的账号时，登录页从 `@webapp-template/common/web-auth` 使用 `SharedAccounts`，由服务端签发管理端会话。

路由和按钮使用 `src/auth/hooks.ts` 中的权限判断函数，角色常量来自共用包，权限编码与服务端的权限种子一致。

```tsx
import AuthButton from "@/components/AuthButton";
import { PERMISSIONS } from "@/constants/permissions";

<AuthButton permission={PERMISSIONS.SYSTEM_USER_EDIT}>编辑用户</AuthButton>
```
