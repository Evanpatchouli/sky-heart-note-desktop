import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { hashPassword, matchesPassword } from '@/auth/password';
import { EVENTS } from '@/constants/events';
import UserCreatedEvent from '@/events/user.created.event';
import { UserModel } from './user.model';
import { RoleService } from '../role-module/role.service';

@Injectable()
export class UserLoginService {
  constructor(
    private readonly users: UserModel,
    private readonly roles: RoleService,
    private readonly events: EventEmitter2,
  ) {}

  async account(username: string, password: string) {
    const user = await this.users
      .getModel()
      .findOne({ username })
      .select('+password');
    if (!user || !(await matchesPassword(password, user.password))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!user.password.startsWith('scrypt$')) {
      await this.users
        .getModel()
        .updateOne(
          { _id: user._id, password: user.password },
          { password: await hashPassword(password) },
        );
    }
    return user.id;
  }

  private async commonRole() {
    const common = await this.roles.findByRoleCode('common');
    if (!common) throw new Error('缺少 common 角色，请执行数据库迁移');
    return common._id;
  }

  async register(username: string, password: string) {
    if (!username.trim() || password.length > 256)
      throw new BadRequestException('用户名或密码无效');
    const record = await this.users.findByUsername(username);
    if (record) throw new ConflictException('用户名已被注册');
    try {
      const user = await this.users.getModel().create({
        username,
        password: await hashPassword(password),
        role_ids: [await this.commonRole()],
        register_at: Date.now(),
      });
      this.events.emit(EVENTS.USER_CREATED, new UserCreatedEvent(user.id));
      return user.id;
    } catch (error) {
      if (error?.code === 11000) throw new ConflictException('用户名已被注册');
      throw error;
    }
  }

  async verifiedContact(field: 'phone' | 'email', value: string) {
    const filter = { [field]: value };
    const existing = await this.users.getModel().findOne(filter);
    if (existing) return existing.id;
    const role = await this.commonRole();
    const user = await this.users.getModel().findOneAndUpdate(
      filter,
      {
        $setOnInsert: { ...filter, role_ids: [role], register_at: Date.now() },
      },
      { upsert: true, returnDocument: 'after' },
    );
    this.events.emit(EVENTS.USER_CREATED, new UserCreatedEvent(user.id));
    return user.id;
  }
}
