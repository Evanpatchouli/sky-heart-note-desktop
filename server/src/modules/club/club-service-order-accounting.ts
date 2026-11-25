import { servicePostingLabel, type ClubBalanceEntry, type ServiceOrderAccounting } from '@sky-club/common';
import type { ClubServiceOrder, ServiceOrderPosting } from './club-service-order.schema';

export function serviceOrderAccounting(order: ClubServiceOrder) {
  const { close, quote, receipt, status: orderStatus } = order;
  const stopped = orderStatus === 'stopped';
  const acceptedUnits = close?.acceptedUnits ?? order.deliveries.filter(delivery => delivery.acceptedAt).length;
  const earnedCents = acceptedUnits * quote.unitPriceCents;
  const receivedCents = receipt?.amountCents ?? 0;
  const refundDueCents = stopped && receipt ? Math.max(0, receivedCents - earnedCents) : 0;
  const refundedCents = (order.refunds ?? []).reduce((total, refund) => total + refund.amountCents, 0);
  const refundRemainingCents = Math.max(0, refundDueCents - refundedCents);
  const netReceivedCents = close?.netReceivedCents ?? receivedCents - refundedCents;
  const postedAmounts = new Map(close?.postings.map(posting => [posting.kind, posting.amountCents]));
  const dispatchFeeCents = close ? postedAmounts.get('service_dispatch_fee') ?? 0 : acceptedUnits * quote.dispatchFeeCents;
  const clubFeeCents = close ? postedAmounts.get('service_club_fee') ?? 0 : acceptedUnits * quote.clubFeeCents;
  const rewardCents = close ? postedAmounts.get('service_reward') ?? 0 : earnedCents - dispatchFeeCents - clubFeeCents;
  const allocatedCents = dispatchFeeCents + clubFeeCents + rewardCents;
  const ended = stopped || (orderStatus === 'completed' && acceptedUnits === order.units);
  const reconciled = ended && !!receipt && netReceivedCents === allocatedCents && rewardCents >= 0 &&
    !!order.dispatcherUserId && (!acceptedUnits || !!order.executorUserId);
  const status: ServiceOrderAccounting['status'] = close ? 'closed' : stopped && !receipt ? 'void' :
    refundRemainingCents > 0 ? 'refund_pending' : reconciled ? 'ready_to_close' : 'in_progress';

  return {
    status, acceptedUnits, receivedCents, refundDueCents, refundedCents, refundRemainingCents, netReceivedCents,
    dispatchFeeCents, rewardCents, clubFeeCents, allocatedCents,
    ...(close ? { closedAt: close.closedAt.toISOString() } : {}),
  };
}

export function serviceOrderPostings(order: ClubServiceOrder, amounts: ReturnType<typeof serviceOrderAccounting>): ServiceOrderPosting[] {
  const postings: ServiceOrderPosting[] = [];
  if (amounts.dispatchFeeCents > 0) postings.push({
    kind: 'service_dispatch_fee', amountCents: amounts.dispatchFeeCents, memberUserId: order.dispatcherUserId!,
  });
  if (amounts.rewardCents > 0) postings.push({ kind: 'service_reward', amountCents: amounts.rewardCents, memberUserId: order.executorUserId! });
  if (amounts.clubFeeCents > 0) postings.push({ kind: 'service_club_fee', amountCents: amounts.clubFeeCents, memberUserId: null });
  return postings;
}

export function serviceBalanceEntries(order: Pick<ClubServiceOrder, '_id' | 'businessType' | 'close'>, memberUserId: string | null): ClubBalanceEntry[] {
  const { close, businessType } = order;
  if (!close) return [];
  const orderId = order._id.toHexString();
  const scope = { orderId, businessType, closeRequestId: close.requestId, occurredAt: close.closedAt.toISOString() };
  return close.postings.filter(posting => posting.memberUserId === memberUserId).map(({ kind, amountCents }) => ({
    ...scope, kind, amountCents, eventId: `club.service.close:${orderId}:${kind}`, reason: servicePostingLabel[kind],
  }));
}
