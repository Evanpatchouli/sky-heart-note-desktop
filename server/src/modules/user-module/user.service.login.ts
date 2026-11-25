import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { hashPassword, matchesPassword } from '@/auth/password';
import { EVENTS } from '@/constants/events';
import UserCreatedEvent from '@/events/user.created.event';
import { UserModel } from './user.model';
import { isDuplicateKey, withNewUserId } from './user-id';
import { RoleService } from '../role-module/role.service';
import { validateAccountCredentials } from './account-credentials';

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

  async register(username: string, password: string) {
    username = validateAccountCredentials(username, password);
    const record = await this.users.findByUsername(username);
    if (record) throw new ConflictException('用户名已被注册');
    const [hashedPassword, role] = await Promise.all([
      hashPassword(password),
      this.roles.requireCommonRoleId(),
    ]);
    try {
      const user = await withNewUserId((_id) =>
        this.users.getModel().create({
          _id,
          username,
          password: hashedPassword,
          role_ids: [role],
          register_at: Date.now(),
        }),
      );
      this.events.emit(EVENTS.USER_CREATED, new UserCreatedEvent(user.id));
      return user.id;
    } catch (error) {
      if (isDuplicateKey(error, 'username'))
        throw new ConflictException('用户名已被注册');
      throw error;
    }
  }

  async verifiedContact(field: 'phone' | 'email', value: string) {
    const filter = { [field]: value };
    const users = this.users.getModel();
    const existing = await users.findOne(filter);
    if (existing) return existing.id;
    const role = await this.roles.requireCommonRoleId();
    try {
      const result = await withNewUserId((_id) =>
        users.findOneAndUpdate(
          filter,
          { $setOnInsert: { _id, ...filter, role_ids: [role], register_at: Date.now() } },
          { upsert: true, returnDocument: 'after', includeResultMetadata: true },
        ).exec(),
      );
      const id = result.value!.id;
      if (result.lastErrorObject?.upserted)
        this.events.emit(EVENTS.USER_CREATED, new UserCreatedEvent(id));
      return id;
    } catch (error) {
      if (isDuplicateKey(error, field)) {
        const user = await users.findOne(filter);
        if (user) return user.id;
      }
      throw error;
    }
  }
}
