import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { appOrigins } from '../../auth/app-access';
import { createOpaqueToken, digestToken, opaqueTokenPattern } from '../../auth/opaque-token';
import { hashPassword } from '../../auth/password';
import { RoleService } from '../role-module/role.service';
import { validateAccountCredentials } from './account-credentials';
import { isDuplicateKey } from './user-id';
import { User } from './user.schema';

const lifetime = 24 * 60 * 60 * 1000;
const empty = { $in: [null, ''] };

function unclaimedCustomer(roleId: Types.ObjectId) {
  return {
    role_ids: [roleId],
    status: 1,
    deleted_at: null,
    username: empty,
    password: empty,
    openid: empty,
    email: empty,
    phone: empty,
    'dispatchActivation.usedAt': null,
  };
}

function invalidLink() {
  return new NotFoundException('激活链接无效或已被替换，请联系原派单人获取新链接');
}

function checkLink(activation: User['dispatchActivation']) {
  if (!activation) throw invalidLink();
  if (activation.usedAt != null)
    throw new ConflictException('激活链接已使用。若刚才提交未收到结果，请用设置的账号和密码登录');
  if (activation.expiresAt <= Date.now())
    throw new GoneException('激活链接已过期，请联系原派单人获取新链接');
}

@Injectable()
export class UserDispatchActivationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly roles: RoleService,
  ) {}

  private async activeCommonRoleId() {
    const role = await this.roles.findByRoleCode('common');
    return role?.status === 1 ? role._id : null;
  }

  async availableOrderIds(orders: { customerUserId: string; orderId: Types.ObjectId }[]) {
    if (orders.length === 0) return new Set<string>();
    const roleId = await this.activeCommonRoleId();
    if (!roleId) return new Set<string>();
    const orderIds = await this.users.distinct('dispatchCustomerOrderId', {
      ...unclaimedCustomer(roleId),
      $or: orders.map(({ customerUserId, orderId }) => ({ _id: customerUserId, dispatchCustomerOrderId: orderId })),
    });
    return new Set(orderIds.map(String));
  }

  async issue(customerUserId: string, orderId: Types.ObjectId) {
    const roleId = await this.activeCommonRoleId();
    if (!roleId) throw new ForbiddenException('普通客户角色已停用，暂无法生成激活链接');
    const token = createOpaqueToken();
    const expiresAt = Date.now() + lifetime;
    const url = new URL('/activate', appOrigins().client);
    url.hash = new URLSearchParams({ token }).toString();
    const { matchedCount } = await this.users.updateOne(
      { ...unclaimedCustomer(roleId), _id: customerUserId, dispatchCustomerOrderId: orderId },
      { $set: { dispatchActivation: { tokenHash: digestToken(token), expiresAt } } },
    );
    if (matchedCount === 0) throw new ConflictException('该老板已有登录凭据或账号状态不允许激活');
    return { activationUrl: url.href, expiresAt };
  }

  async activate(token: string, username: string, password: string) {
    if (!opaqueTokenPattern.test(token)) throw invalidLink();
    const tokenHash = digestToken(token);
    const lookup = { 'dispatchActivation.tokenHash': tokenHash, dispatchCustomerOrderId: { $exists: true } };
    const findActivation = () => this.users.findOne(lookup)
      .select({ _id: 1, dispatchActivation: 1 }).lean();
    const account = await findActivation();
    if (!account) throw invalidLink();
    checkLink(account.dispatchActivation);
    const roleId = await this.activeCommonRoleId();
    if (!roleId) throw new ForbiddenException('普通客户角色已停用，暂无法激活账号');
    const target = { ...unclaimedCustomer(roleId), ...lookup, _id: account._id };
    const login = validateAccountCredentials(username, password);
    const credential = await hashPassword(password);
    const now = Date.now();
    try {
      const { matchedCount } = await this.users.updateOne(
        { ...target, 'dispatchActivation.expiresAt': { $gt: now } },
        { $set: { username: login, password: credential, 'dispatchActivation.usedAt': now } },
      );
      if (matchedCount) return;
    } catch (error) {
      if (isDuplicateKey(error, 'username')) throw new ConflictException('用户名已被注册，请换一个用户名');
      throw error;
    }

    // Another request may have consumed or rotated the link while hashing the password.
    checkLink((await findActivation())?.dispatchActivation);
    throw new ForbiddenException('该老板已有登录凭据或账号状态不允许激活');
  }
}
