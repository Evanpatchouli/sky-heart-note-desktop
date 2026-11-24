import mongoose from 'mongoose';
import { RoleSchema } from '../modules/role-module/role.schema';

export async function v4() {
  const roles = mongoose.model('Role', RoleSchema);
  await roles.updateOne(
    { role_code: 'employee', role_name: '员工' },
    { $set: { role_name: '团员' } },
  );
}
