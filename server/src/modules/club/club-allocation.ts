import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PublishOrderDto } from './club-allocation.dto';
import type { ClubOrder } from './club-order.schema';
import { deliveryTarget } from './club-order-pricing';
import { deliveryStoppedAt } from './club-termination';

export const SELF_CLAIM_PENDING =
  '同单自派自接规则待确认，当前只能由其他团员承接';

export function sortDirectedShares(directed: NonNullable<PublishOrderDto['directed']>) {
  return directed
    .map(({ userId, hearts }) => ({ userId, hearts }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

export function makeAllocation(order: ClubOrder, input: PublishOrderDto) {
  const { requestId, publicHearts } = input;
  if (publicHearts === undefined || !input.directed) {
    throw new BadRequestException('请填写公开和定向份额');
  }
  const directed = sortDirectedShares(input.directed);
  const assignedUserIds = new Set<string>();
  const target = deliveryTarget(order);
  let remaining = target - publicHearts;
  for (const { userId, hearts } of directed) {
    if (userId === order.dispatcherUserId)
      throw new ConflictException(SELF_CLAIM_PENDING);
    if (assignedUserIds.has(userId))
      throw new BadRequestException('同一团员只能指定一份份额');
    assignedUserIds.add(userId);
    remaining -= hearts;
    if (remaining < 0) break;
  }
  if (remaining !== 0) {
    const quantity = target === order.heartDelivery.requestedHearts ? '订购颗数' : '交付总量';
    throw new BadRequestException(`公开和定向份额的颗数合计须等于${quantity}`);
  }
  return {
    requestId,
    publicHearts,
    publicRemainingHearts: publicHearts,
    directed,
  };
}

export function dispatchAllocationView(
  order: ClubOrder,
  names?: Map<string, string>,
) {
  const allocation = order.allocation;
  if (!allocation) return null;
  const acceptedRecipients = new Set(
    order.shares
      .filter(({ claimKind }) => claimKind === 'directed')
      .map(({ userId }) => userId),
  );
  const stoppedAt = deliveryStoppedAt(order);
  const directedPendingHearts = allocation.directed.reduce(
    (total, { userId, hearts }) => total + (acceptedRecipients.has(userId) ? 0 : hearts), 0,
  );
  return {
    ...(order.dispatchWithdrawnAt ? { withdrawnAt: order.dispatchWithdrawnAt } : {}),
    ...(stoppedAt ? { stoppedAt, originallyUnclaimedHearts: allocation.publicRemainingHearts + directedPendingHearts } : {}),
    publicHearts: allocation.publicHearts,
    publicRemainingHearts: stoppedAt ? 0 : allocation.publicRemainingHearts,
    directedPendingHearts: stoppedAt ? 0 : directedPendingHearts,
    claimedHearts: order.shares.reduce(
      (total, { hearts }) => total + hearts,
      0,
    ),
    directed: allocation.directed.map(({ userId, hearts }) => ({
      userId,
      hearts,
      nickname: names?.get(userId) ?? null,
      accepted: acceptedRecipients.has(userId),
    })),
    shares: order.shares.map(({ userId, hearts, claimKind }) => ({
      userId,
      hearts,
      nickname: names?.get(userId) ?? null,
      kind: claimKind,
    })),
  };
}
