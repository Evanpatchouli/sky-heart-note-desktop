import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isObjectIdOrHexString, Model, QueryFilter, Types } from 'mongoose';
import type { ClaimOrderDto } from './club-allocation.dto';
import { SELF_CLAIM_PENDING } from './club-allocation';
import { ClubDirectoryService } from './club-directory.service';
import type { ClaimBoardQuery } from './club-order.dto';
import { activityQuantities } from './club-order-pricing';
import { ClubOrder, type ClubOrderShare } from './club-order.schema';
import { adjustmentDeliveryHold } from './club-price-adjustment';
import { deliveryStoppedAt } from './club-termination';

const DISPATCH_WITHDRAWN = '这笔派单已撤回';

function canViewAllocation(order: ClubOrder, userId: string) {
  return (
    order.allocation!.publicHearts > 0 ||
    order.allocation!.directed.some((share) => share.userId === userId) ||
    order.dispatcherUserId === userId ||
    order.shares.some((share) => share.userId === userId)
  );
}

function claimReceipt(share: ClubOrderShare) {
  return {
    id: share._id.toHexString(),
    userId: share.userId,
    hearts: share.hearts,
    kind: share.claimKind,
    claimedAt: share.claimedAt,
  };
}

function claimView(order: ClubOrder, userId: string) {
  const allocation = order.allocation!;
  const myShares = order.shares.filter((share) => share.userId === userId);
  const myClaimedHearts = myShares.reduce(
    (total, { hearts }) => total + hearts,
    0,
  );
  const acceptedDirected = myShares.some(
    ({ claimKind }) => claimKind === 'directed',
  );
  const directed = allocation.directed.find((share) => share.userId === userId);
  const claimingOwnOrder = order.dispatcherUserId === userId;
  const stoppedAt = deliveryStoppedAt(order);
  return {
    id: order._id.toHexString(),
    clubId: order.clubId,
    source: order.source,
    dispatcherUserId: order.dispatcherUserId,
    publishedAt: order.publishedAt,
    requestedHearts: order.heartDelivery.requestedHearts,
    ...activityQuantities(order),
    publicRemainingHearts: stoppedAt ? 0 : allocation.publicRemainingHearts,
    directedPendingHearts: stoppedAt || acceptedDirected ? 0 : (directed?.hearts ?? 0),
    myClaimedHearts,
    ...(stoppedAt ? { stoppedAt } : {}),
    ...(myClaimedHearts
      ? { recipientGameAccount: order.recipientGameAccount }
      : {}),
    ...(claimingOwnOrder || adjustmentDeliveryHold(order)
      ? { claimBlockReason: adjustmentDeliveryHold(order) ?? SELF_CLAIM_PENDING }
      : {}),
  };
}

@Injectable()
export class ClubClaimService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly directory: ClubDirectoryService,
  ) {}

  async list(clubId: string, userId: string, query: ClaimBoardQuery) {
    await this.directory.requireMember(clubId, userId);
    const limit = query.limit ?? 25;
    const orders = await this.orders
      .find({
        ...this.scope(clubId, userId),
        dispatchWithdrawnAt: null,
        termination: null,
        'priceAdjustment.decision.value': { $ne: 'decline' },
        ...(query.claimKind ? {
          dispatcherUserId: { $ne: userId },
          'priceAdjustment.state': { $nin: ['awaiting_customer', 'awaiting_supplement', 'refund_due', 'refunded'] },
          ...(query.claimKind === 'public' ? { 'allocation.publicRemainingHearts': { $gt: 0 } } : {
            'allocation.directed.userId': userId,
            shares: { $not: { $elemMatch: { userId, claimKind: 'directed' } } },
          }),
        } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.after
          ? { _id: { $lt: new Types.ObjectId(query.after) } }
          : {}),
      })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const nextCursor =
      orders.length > limit ? orders[limit - 1]._id.toHexString() : null;
    return {
      items: orders.slice(0, limit).map((order) => claimView(order, userId)),
      nextCursor,
    };
  }

  async detail(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(clubId, userId, orderId);
    this.requireOpenDispatch(order);
    return claimView(order, userId);
  }

  locateLegacyOrder(order: ClubOrder, userId: string) {
    const { clubId } = order;
    if (!order.allocation) return { clubId, status: 'unavailable' as const };
    if (!canViewAllocation(order, userId))
      return { clubId, status: 'directed_elsewhere' as const };
    return { clubId, status: 'located' as const, order: claimView(order, userId) };
  }

  async claim(
    clubId: string,
    userId: string,
    orderId: string,
    input: ClaimOrderDto,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.get(clubId, userId, orderId);
    if (order.dispatcherUserId === userId)
      throw new ConflictException(SELF_CLAIM_PENDING);

    const prior = this.replayClaim(order, userId, input);
    if (prior) return prior;
    this.requireClaimableDispatch(order);

    const { kind, hearts, requestId } = input;
    const allocation = order.allocation!;
    const directed = allocation.directed.find(
      (share) => share.userId === userId,
    );
    if (kind === 'directed') {
      if (!directed) throw new ForbiddenException('本单没有指定给你的份额');
      if (directed.hearts !== hearts)
        throw new ConflictException('请按指定的颗数确认承接');
    }

    const isPublic = kind === 'public';
    const share = {
      _id: new Types.ObjectId(),
      userId,
      hearts,
      claimKind: kind,
      claimRequestId: requestId,
      claimedAt: new Date(),
      executionGameAccounts: [],
    };
    const { modifiedCount } = await this.orders.updateOne(
      {
        _id: order._id,
        clubId,
        dispatchStatus: 'published',
        dispatchWithdrawnAt: null,
        'priceAdjustment.state': { $in: [null, 'continuing'] },
        termination: null,
        dispatcherUserId: { $ne: userId },
        'allocation.requestId': allocation.requestId,
        $nor: [
          { shares: { $elemMatch: { userId, claimRequestId: requestId } } },
          ...(isPublic
            ? []
            : [{ shares: { $elemMatch: { userId, claimKind: 'directed' } } }]),
        ],
        ...(isPublic
          ? { 'allocation.publicRemainingHearts': { $gte: hearts } }
          : { 'allocation.directed': { $elemMatch: { userId, hearts } } }),
      },
      {
        $push: { shares: share },
        $inc: {
          fulfillmentRevision: 1,
          ...(isPublic ? { 'allocation.publicRemainingHearts': -hearts } : {}),
        },
      },
      { runValidators: true },
    );
    if (modifiedCount) return claimReceipt(share);

    const latest = await this.get(clubId, userId, orderId);
    const replay = this.replayClaim(latest, userId, input);
    if (replay) return replay;
    this.requireClaimableDispatch(latest);
    if (
      !isPublic &&
      latest.shares.some(
        (share) => share.userId === userId && share.claimKind === 'directed',
      )
    )
      throw new ConflictException('你已接受本单指定给你的份额');
    throw new ConflictException('可领份额已变化，请核对最新余量后再试');
  }

  private scope(clubId: string, userId: string): QueryFilter<ClubOrder> {
    return {
      clubId,
      dispatchStatus: 'published',
      'allocation.requestId': { $exists: true },
      $or: [
        { 'allocation.publicHearts': { $gt: 0 } },
        { 'allocation.directed.userId': userId },
        { dispatcherUserId: userId },
        { 'shares.userId': userId },
      ],
    };
  }

  private async get(clubId: string, userId: string, orderId: string) {
    if (!isObjectIdOrHexString(orderId))
      throw new BadRequestException('订单标识格式无效');
    const order = await this.orders
      .findOne({ ...this.scope(clubId, userId), _id: orderId })
      .lean();
    if (!order) throw new NotFoundException('当前没有可查看的已发布派单');
    return order;
  }

  private requireOpenDispatch(order: ClubOrder) {
    if (order.dispatchWithdrawnAt) throw new ConflictException(DISPATCH_WITHDRAWN);
  }

  private requireClaimableDispatch(order: ClubOrder) {
    this.requireOpenDispatch(order);
    const hold = adjustmentDeliveryHold(order);
    if (hold) throw new ConflictException(hold);
  }

  private replayClaim(order: ClubOrder, userId: string, input: ClaimOrderDto) {
    const saved = order.shares.find(
      (share) =>
        share.userId === userId && share.claimRequestId === input.requestId,
    );
    if (!saved) return null;
    if (saved.hearts !== input.hearts || saved.claimKind !== input.kind)
      throw new ConflictException('相同提交标识已用于内容不同的承接请求');
    return claimReceipt(saved);
  }
}
