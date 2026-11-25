import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model, Types } from 'mongoose';
import { EmployeeService } from '../employee/employee.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubGiftExecutionService } from './club-gift-execution.service';
import { deliveryStoppedAt } from './club-termination';
import {
  ClubOrder,
  type ClubOrderShare,
  type ExecutionGameAccount,
} from './club-order.schema';

export function claimedOrderScope(clubId: string, userId: string) {
  return { clubId, dispatchStatus: 'published', 'shares.userId': userId };
}

export function executionAccountView(account: ExecutionGameAccount) {
  return {
    id: account._id.toHexString(),
    name: account.name,
    ...(account.personalAccountId
      ? {
          personalAccountId: account.personalAccountId,
          localAccountId: account.localAccountId,
          linkedAt: account.linkedAt,
        }
      : {}),
  };
}


@Injectable()
export class ClubExecutionService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
    private readonly employee: EmployeeService,
    private readonly giftExecution: ClubGiftExecutionService,
  ) {}

  async linkAccount(
    clubId: string,
    userId: string,
    orderId: string,
    shareId: string,
    personalAccountId: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    if (await this.isGiftTimesOrder(clubId, orderId)) {
      return this.giftExecution.linkAccount(clubId, userId, orderId, shareId, personalAccountId);
    }
    const { order, share } = await this.getShare(
      clubId,
      userId,
      orderId,
      shareId,
    );
    const prior = this.linkReplay(order, share, personalAccountId);
    if (prior) return prior;
    if (deliveryStoppedAt(order)) throw new ConflictException('本单已停送，无法关联新的送心号');

    const personal = this.employee.findLinkableGameAccount(
      userId,
      personalAccountId,
    );
    if (!personal)
      throw new NotFoundException('该个人送心号已不可用，请刷新后选择');
    const account: ExecutionGameAccount = {
      _id: new Types.ObjectId(),
      personalAccountId,
      localAccountId: personal.localId,
      name: personal.name,
      linkedAt: new Date(),
    };
    const shareScope = { _id: share._id, userId };
    const { modifiedCount } = await this.orders.updateOne(
      {
        ...claimedOrderScope(clubId, userId),
        _id: order._id,
        termination: null,
        'priceAdjustment.decision.value': { $ne: 'decline' },
        shares: { $elemMatch: shareScope },
        $nor: [
          {
            shares: {
              $elemMatch: {
                userId,
                'executionGameAccounts.personalAccountId': personalAccountId,
              },
            },
          },
        ],
      },
      { $push: { 'shares.$[share].executionGameAccounts': account } },
      {
        arrayFilters: [{ 'share._id': share._id, 'share.userId': userId }],
        runValidators: true,
      },
    );
    if (modifiedCount) return executionAccountView(account);

    const latest = await this.getShare(clubId, userId, orderId, shareId);
    const replay = this.linkReplay(
      latest.order,
      latest.share,
      personalAccountId,
    );
    if (replay) return replay;
    throw new ConflictException('份额已变化，请刷新后重试');
  }

  private isGiftTimesOrder(clubId: string, orderId: string) {
    return isObjectIdOrHexString(orderId) &&
      this.orders.exists({ _id: orderId, clubId, 'dispatchPricing.priceUnit': 'gift_times' });
  }

  private async getShare(
    clubId: string,
    userId: string,
    orderId: string,
    shareId: string,
  ) {
    if (!isObjectIdOrHexString(orderId) || !isObjectIdOrHexString(shareId))
      throw new BadRequestException('订单或承接份额标识格式无效');
    const scope = { _id: new Types.ObjectId(shareId), userId };
    const order = await this.orders
      .findOne({
        ...claimedOrderScope(clubId, userId),
        _id: orderId,
        shares: { $elemMatch: scope },
      })
      .lean();
    const share = order?.shares.find(
      (item) => item._id.equals(scope._id) && item.userId === userId,
    );
    if (!order || !share) throw new NotFoundException('该承接份额不存在');
    return { order, share };
  }

  private linkReplay(
    order: ClubOrder,
    share: ClubOrderShare,
    personalAccountId: string,
  ) {
    const current = share.executionGameAccounts?.find(
      (account) => account.personalAccountId === personalAccountId,
    );
    if (current) return executionAccountView(current);
    if (
      order.shares.some(
        (item) =>
          item.userId === share.userId &&
          item.executionGameAccounts?.some(
            (account) => account.personalAccountId === personalAccountId,
          ),
      )
    ) {
      throw new ConflictException('该送心号已关联本单的另一份承接');
    }
    return null;
  }
}
