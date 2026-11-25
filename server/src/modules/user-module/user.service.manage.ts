import { Injectable } from '@nestjs/common';
import { User } from './user.schema';
import { UserModel } from './user.model';
import { QueryFilter } from 'mongoose';
import { PaginatedResult } from '@sky-club/common';
import CustomError from '@/exception/CustomError';
import { hashPassword } from '@/auth/password';
import { randomBytes } from 'node:crypto';
import { toObjectId } from '@/utils/mapper';

@Injectable()
export class UserManageService {
  constructor(private readonly userModel: UserModel) {}

  /**
   * 分页查询
   */
  async findPage(
    page: number,
    pageSize: number,
    filter?: QueryFilter<User>,
  ): Promise<PaginatedResult<User>> {
    return this.userModel.findPage(page, pageSize, filter);
  }

  async getUserDetail(user_id: string): Promise<User> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    return user;
  }

  async toggleUserStatus(user_id: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { status: user.status === 1 ? 0 : 1 });
  }

  async updatePhone(user_id: string, phone: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { phone });
  }

  async updateWchat(user_id: string, openid: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { openid });
  }

  async updateEmail(user_id: string, email: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { email });
  }

  async updateRoles(user_id: string, role_ids: string[]): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { role_ids: role_ids.map(toObjectId) });
  }

  async resetPassword(user_id: string): Promise<string> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    const password = randomBytes(16).toString('base64url');
    await this.userModel.updateById(user_id, { password: await hashPassword(password) });
    return password;
  }

  async deleteUser(user_id: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { deleted_at: Date.now() });
  }

  async restoreUser(user_id: string): Promise<void> {
    const user = await this.userModel.findById(user_id);
    if (!user) {
      throw new CustomError(`User(id: ${user_id}) not found`);
    }
    await this.userModel.updateById(user_id, { deleted_at: null as any });
  }
}
