import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { ADMIN_USER_ID } from '@/constants/user';
import { hashPassword } from '@/auth/password';
import { RoleSchema } from '../modules/role-module/role.schema';
import { PermissionSchema } from '../modules/permission-module/permission.schema';
import { UserSchema } from '../modules/user-module/user.schema';

export async function v3() {
  const roles = mongoose.model('Role', RoleSchema);
  const users = mongoose.model('User', UserSchema);
  const permissions = mongoose.model('Permission', PermissionSchema);
  const roleIds = new Map<string, mongoose.Types.ObjectId>();
  for (const [code, name] of [
    ['admin', '管理员'],
    ['employee', '员工'],
    ['common', '普通用户'],
  ]) {
    const role = await roles.findOneAndUpdate(
      { role_code: code },
      {
        $setOnInsert: {
          role_name: name,
          is_system: true,
          status: 1,
          permission_ids:
            code === 'admin' ? await permissions.distinct('_id') : [],
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    roleIds.set(code, role._id);
  }
  const adminId = roleIds.get('admin')!;
  const commonId = roleIds.get('common')!;
  const legacyAdmin = await roles.findOne({
    role_code: 'SUPER_ADMIN',
    status: 1,
  });
  if (legacyAdmin) {
    await users.updateMany(
      { role_ids: legacyAdmin._id },
      { $addToSet: { role_ids: adminId } },
    );
  }
  // Preserve the legacy roles while enabling client access for existing accounts.
  await users.updateMany(
    { role_ids: { $nin: [...roleIds.values()] } },
    { $addToSet: { role_ids: commonId } },
  );
  const bootstrap = await users.findById(ADMIN_USER_ID).select('+password');
  // Old releases bound their author's example contacts to this fixed ID.
  // Compare fingerprints so the public seed identities are not redistributed.
  if (bootstrap) {
    const legacyContacts = {
      openid:
        '2f2a329cdfc38c8c3661b7b80c29261c4aee278a6655ce3cc33a6f3483326f84',
      phone: 'd9910c751ba37e1d6cd19295503aa1226f2d643bc0b54234068721b7763d11c0',
      email: '2753237145f86d513e5f37476092260b5ed5431ab33d7ab8a8c80c4779a153b8',
    };
    for (const field of ['openid', 'phone', 'email'] as const) {
      const value = bootstrap[field];
      if (
        value &&
        createHash('sha256').update(value).digest('hex') ===
          legacyContacts[field]
      ) {
        await users.updateOne(
          { _id: ADMIN_USER_ID, [field]: value },
          { $unset: { [field]: 1 } },
        );
      }
    }
  }
  const hasAdmin = await users.exists({ role_ids: adminId, deleted_at: null });
  if (
    !hasAdmin ||
    (bootstrap?.username === 'root' && bootstrap.password === 'root')
  ) {
    const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'root';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password)
      throw new Error('请设置 BOOTSTRAP_ADMIN_PASSWORD 来初始化管理员');
    if (bootstrap && !bootstrap.role_ids.some((id) => id.equals(adminId))) {
      throw new Error(
        '初始化管理员 ID 已被使用，请向现有管理员分配 admin 角色后重试',
      );
    }
    const owner = await users.findOne({ username });
    if (owner && !owner._id.equals(ADMIN_USER_ID))
      throw new Error('初始化管理员用户名已被使用');
    await users.updateOne(
      { _id: ADMIN_USER_ID },
      {
        $set: { username, password: await hashPassword(password) },
        $setOnInsert: { nickname: '管理员', status: 1 },
        $addToSet: { role_ids: adminId },
      },
      { upsert: true },
    );
  }
}
