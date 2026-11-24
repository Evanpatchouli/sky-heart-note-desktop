import mongoose from 'mongoose';
import { hashPassword } from '@/auth/password';
import { RoleSchema } from '../modules/role-module/role.schema';
import { PermissionSchema } from '../modules/permission-module/permission.schema';
import { UserSchema } from '../modules/user-module/user.schema';
import { isDuplicateKey, withNewUserId } from '../modules/user-module/user-id';

export async function v3() {
  const roles = mongoose.model('Role', RoleSchema);
  const users = mongoose.model('User', UserSchema);
  const permissions = mongoose.model('Permission', PermissionSchema);
  const roleIds = new Map<string, mongoose.Types.ObjectId>();
  for (const [code, name] of [
    ['admin', '管理员'],
    ['employee', '团员'],
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
  const hasAdmin = await users.exists({ role_ids: adminId, deleted_at: null });
  if (hasAdmin) return;

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'root';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password)
    throw new Error('请设置 BOOTSTRAP_ADMIN_PASSWORD 来初始化管理员');
  await users.init();
  const hashedPassword = await hashPassword(password);
  try {
    await withNewUserId((_id) =>
      users.create({
        _id,
        username,
        password: hashedPassword,
        nickname: '管理员',
        is_bootstrap_admin: true,
        role_ids: [adminId],
      }),
    );
  } catch (error) {
    if (!isDuplicateKey(error, 'username')) throw error;
    const initialized = await users.exists({
      username,
      is_bootstrap_admin: true,
      role_ids: adminId,
    });
    if (!initialized) throw new Error('初始化管理员用户名已被使用');
  }
}
