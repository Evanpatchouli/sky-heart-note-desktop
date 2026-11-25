import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startClubSystem } from './club-test-system.mjs';

test('罚款与额外补偿使用各自的凭据和入账时点', { timeout: 90000 }, async (t) => {
  const { db, api, administrator, login, register, runCommand, seedClub, startPeer } =
    await startClubSystem(t, { database: 'club_adjustments_e2e', adminUsername: 'adjustment_admin' });
  const leader = await login('employee', 'adjustment_admin');
  const dispatcher = await register('adjustment_dispatcher', 'employee');
  const member = await register('adjustment_member', 'employee');
  const deputy = await register('adjustment_deputy', 'employee');
  const finance = await register('adjustment_finance', 'admin');
  const customer = await register('adjustment_customer', 'client');
  await runCommand('dist/src/commands/club.js', 'init-leader', leader.id);
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  for (const actor of [member, deputy, finance]) await seedClub('member', actor.id, 'active', 'member');
  await seedClub('position', deputy.id, 'deputy');
  await seedClub('grant', finance.id, 'CLUB_FINANCE_READ');

  const call = (app, actor, path, body, method = body ? 'POST' : 'GET', status = method === 'POST' ? 201 : 200, server) =>
    api(app, `/${app}${path}`, { token: actor.token, method, body, status, server });
  const admin = (actor, path, body, method, status, server) => call('admin', actor, '/club' + path, body, method, status, server);
  const employee = (actor, path, body, method, status, server) => call('employee', actor, '/club' + path, body, method, status, server);
  const balance = (actor) => employee(actor, '/balance');
  const clubBalance = () => admin(finance, '/balance');
  const peer = await startPeer();
  const retry = async (action) => {
    const [original, duplicate] = await Promise.all([action(), action(peer)]);
    assert.deepEqual(original, duplicate);
    return original;
  };

  assert.equal((await admin(finance, '/penalties')).canPublish, false);
  assert.equal((await admin(administrator, '/penalties')).canPublish, true);
  const independent = { requestId: randomUUID(), memberUserId: leader.id, amountCents: 200, reason: '独立罚款' };
  await admin(finance, '/penalties', independent, 'POST', 403);
  const issued = await retry(server => admin(administrator, '/penalties', independent, 'POST', 201, server));
  assert.equal(issued.requestedByUserId, issued.decidedByUserId);
  assert.equal(issued.penaltyPosting, 'posted');
  assert.equal((await balance(leader)).balanceCents, -200);
  assert.equal((await clubBalance()).balanceCents, 200);

  await admin(administrator, '/commission-rule', { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  const paid = await call('client', customer, '/orders', {
    requestId: randomUUID(), dispatcherUserId: dispatcher.id, recipientGameAccount: '额外补偿验收', requestedGiftTimes: 100,
  });
  const order = `/orders/${paid.id}`;
  const adjustments = `${order}/financial-adjustments`;
  const settlement = `${order}/settlement`;
  const financeSettlement = () => admin(finance, settlement);
  await employee(dispatcher, `${order}/pricing`, {
    expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
    giftSegments: [{ period: 'normal', paidGiftTimes: 100, dailyGiftTimes: 100, unitPriceCents: 50 }],
  }, 'PATCH');
  await employee(dispatcher, `${order}/receipts`, {
    requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 5000, receivedAt: '2026-11-01T00:00:00+08:00',
  });
  await employee(dispatcher, `${order}/publish`, {
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, startDate: '2026-11-02', endDate: '2026-11-02', openToClaim: true, directed: [] }],
  });
  await call('employee', member, '/songxinhao', { name: '补偿对账送心号' });
  const [account] = await call('employee', member, '/songxinhao/linkable');
  const { shareId } = await employee(member, `/gift-claims/${paid.id}`, {
    requestId: randomUUID(), kind: 'public', segmentIndex: 0, dailyGiftTimes: 100,
  });
  const execution = `${order}/shares/${shareId}/execution-accounts`;
  const linked = await employee(member, execution, { personalAccountId: account.id });
  await employee(member, `${execution}/${linked.id}/daily-reports`, {
    requestId: randomUUID(), kind: 'daily', businessDate: '2026-11-02',
    lines: [{ period: 'normal', giftTimes: 100, receivedHearts: 100 }],
  });

  const submit = (kind, amountCents, reason, memberUserId) => {
    const input = { requestId: randomUUID(), kind, amountCents, reason, memberUserId };
    return retry(server => employee(dispatcher, adjustments, input, 'POST', 201, server));
  };
  const penalty = await submit('member_penalty', 200, '订单责任罚款', member.id);
  const rejected = await submit('member_penalty', 800, '申请驳回的罚款', member.id);
  const compensation = await submit('customer_compensation', 500, '额外售后补偿');
  assert.equal(compensation.customerUserId, customer.id);
  assert.equal((await balance(member)).balanceCents, 0);
  assert.equal((await clubBalance()).balanceCents, 200);
  await employee(member, adjustments, undefined, 'GET', 404);
  await employee(dispatcher, '/financial-adjustments', undefined, 'GET', 403);
  await call('client', customer, '/club/balance', undefined, 'GET', 404);

  const decide = (actor, record, decision, status = 200, server) => employee(actor,
    `/financial-adjustments/${record.id}/decision`, { expectedRevision: 1, decision }, 'PATCH', status, server);
  await decide(dispatcher, penalty, 'approved', 403);
  const effective = await retry(server => decide(deputy, penalty, 'approved', 200, server));
  assert.equal(effective.id, penalty.id);
  assert.equal(effective.revision, 2);
  assert.equal(effective.penaltyPosting, 'awaiting_close');
  assert.equal((await decide(leader, rejected, 'rejected')).status, 'rejected');
  const beforeRefund = await balance(member);
  assert.equal(beforeRefund.balanceCents, 0);
  assert.deepEqual(beforeRefund.pendingPenalties.map(({ id }) => id), [penalty.id]);
  assert.equal(beforeRefund.pendingPenalties[0].orderId, undefined);

  const refundPath = `${adjustments}/${compensation.id}/refunds`;
  const first = { requestId: randomUUID(), expectedRevision: 2, amountCents: 300, occurredAt: '2026-11-23T12:00:00+08:00' };
  await employee(dispatcher, refundPath, first, 'POST', 409);
  assert.equal((await decide(deputy, compensation, 'approved')).id, compensation.id);
  const refundDue = await financeSettlement();
  assert.equal(refundDue.status, 'review_required');
  assert.deepEqual([refundDue.cash.compensationRefundDueCents, refundDue.cash.compensationRefundedCents,
    refundDue.cash.compensationRefundRemainingCents, refundDue.cash.netReceivedCents], [500, 0, 500, 5000]);
  assert.equal((await clubBalance()).balanceCents, 200);
  await employee(deputy, refundPath, first, 'POST', 404);
  await employee(dispatcher, refundPath, { ...first, occurredAt: '2026-10-31T00:00:00+08:00' }, 'POST', 400);
  const partial = await retry(server => employee(dispatcher, refundPath, first, 'POST', 201, server));
  assert.equal(partial.refunds.length, 1);
  assert.equal(partial.refunds[0].recordedByUserId, dispatcher.id);
  assert.equal((await clubBalance()).balanceCents, -100);
  const second = { ...first, requestId: randomUUID(), expectedRevision: 3, amountCents: 200, evidence: '退款凭据' };
  await employee(dispatcher, refundPath, { ...second, amountCents: 201 }, 'POST', 409);
  const finalRefund = await retry(server => employee(dispatcher, refundPath, second, 'POST', 201, server));
  assert.deepEqual(finalRefund.refunds.map(({ amountCents }) => amountCents), [300, 200]);
  assert.equal(finalRefund.refunds[1].evidence, second.evidence);
  const buyer = await call('client', customer, '/orders/' + paid.id);
  assert.equal(buyer.settlement.cash.netReceivedCents, 4500);
  assert.equal(buyer.settlement.cash.compensationRefundedCents, 500);
  assert.equal(buyer.settlement.adjustments, undefined);
  assert.equal((await clubBalance()).balanceCents, -300);
  assert.equal(await db.collection('club_financial_adjustments').countDocuments(), 4);

  const pendingAtClose = await submit('member_penalty', 50, '结单后不可审批', member.id);
  const ready = await financeSettlement();
  assert.equal(ready.status, 'ready_to_close');
  assert.deepEqual([ready.cash.compensationRefundDueCents, ready.cash.compensationRefundedCents,
    ready.cash.compensationRefundRemainingCents, ready.cash.netReceivedCents], [500, 500, 0, 4500]);
  const closeInput = { requestId: randomUUID(), calculationId: ready.finalCalculation.id };
  const close = await retry(server => employee(dispatcher, `${settlement}/close`, closeInput, 'POST', 201, server));
  await decide(leader, pendingAtClose, 'approved', 409);
  await admin(administrator, '/penalties', { ...independent, requestId: randomUUID(), orderId: paid.id }, 'POST', 409);
  assert.equal((await decide(deputy, penalty, 'approved')).penaltyPosting, 'posted');
  const reconciled = await financeSettlement();
  assert.deepEqual(reconciled.close, close);
  assert.equal(reconciled.adjustments.find(row => row.id === penalty.id).penaltyPosting, 'posted');
  assert.deepEqual(reconciled.adjustments.find(row => row.id === compensation.id).refunds, finalRefund.refunds);
  assert.deepEqual([reconciled.totals.customerCompensationCents, reconciled.totals.memberPenaltyCents,
    reconciled.totals.clubNetCents, reconciled.totals.differenceCents], [500, 200, 200, 0]);
  const afterClose = await balance(member);
  assert.equal(afterClose.balanceCents, 3800);
  assert.deepEqual(afterClose.pendingPenalties, []);
  assert.deepEqual(afterClose.entries.filter(row => row.adjustmentId === penalty.id)
    .map(row => [row.kind, row.amountCents, row.occurredAt]), [['member_penalty', -200, close.closedAt]]);
  const team = await clubBalance();
  assert.equal(team.balanceCents, 400);
  assert.deepEqual(team.entries.filter(row => row.orderId === paid.id && row.adjustmentId === penalty.id)
    .map(row => [row.kind, row.amountCents, row.occurredAt]), [['member_penalty', 200, close.closedAt]]);
  assert.deepEqual(team.entries.filter(row => row.orderId === paid.id && row.adjustmentId === compensation.id)
    .map(row => row.amountCents).sort((a, b) => a - b), [-300, -200]);

  await seedClub('member', dispatcher.id, 'active', 'member');
  const unassigned = await call('client', customer, '/orders', {
    requestId: randomUUID(), recipientGameAccount: '尚未指派', requestedGiftTimes: 1,
  });
  assert.equal(unassigned.dispatchStatus, 'pending_assignment');
  const unpostable = { ...independent, requestId: randomUUID(), orderId: unassigned.id };
  await admin(administrator, '/penalties', unpostable, 'POST', 409);
  await call('client', customer, `/orders/${unassigned.id}/cancel-before-assignment`, { requestId: randomUUID() });
  await admin(administrator, '/penalties', unpostable, 'POST', 409);
  assert.equal(await db.collection('club_financial_adjustments').countDocuments(), 5);
});
