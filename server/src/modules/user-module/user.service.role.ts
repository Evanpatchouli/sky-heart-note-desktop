import { Injectable, NotFoundException } from '@nestjs/common';
import { UserModel } from './user.model';
import { RoleService } from '../role-module/role.service';

@Injectable()
export class UserRoleService {
  constructor(
    private readonly users: UserModel,
    private readonly roles: RoleService,
  ) {}

  async getRoles(userId: string, options?: { withPermission?: boolean }) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('用户不存在');
    return this.roles.findByIds(user.role_ids.map(String), options);
  }
}
