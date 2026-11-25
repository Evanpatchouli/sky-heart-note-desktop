import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { revisedCouponState, settlementCouponChange } from '../dist/src/modules/club/club-settlement-close.js';
import { startClubSystem } from './club-test-system.mjs';

test('普通退单与拒补停送的已结日报更正按最新实际赠送返券', () => {
  const couponId = 'original-coupon';
  const previousReturnedAt = '2026-11-20T00:00:00.000Z';
  const usedAt = '2026-11-21T00:00:00.000Z';
  const returnedAt = '2026-11-22T00:00:00.000Z';
  const payout = { receipt: { quote: { promotions: { platform: { couponId } } } } };
  const zero = { stopped: true, observedGiftTimes: 0 };
  const positive = { stopped: true, observedGiftTimes: 1 };
  for (const stop of [{ giftTermination: { id: 'ordinary-stop' } }, { giftPriceAdjustmentState: 'stopped' }]) {
    const returnedOrder = { ...payout, ...stop, promotionCouponReturnedAt: previousReturnedAt };
    const used = settlementCouponChange(returnedOrder, zero, positive, usedAt);
    assert.deepEqual(used, { couponId, status: 'used', changedAt: usedAt, previousReturnedAt });
    assert.deepEqual(revisedCouponState(used), { activePromotionCouponId: couponId, promotionCouponReturnedAt: undefined });
    const usedOrder = { ...returnedOrder, ...revisedCouponState(used) };
    const returned = settlementCouponChange(usedOrder, positive, zero, returnedAt);
    assert.deepEqual(returned, { couponId, status: 'returned', changedAt: returnedAt });
    assert.deepEqual(revisedCouponState(returned), { activePromotionCouponId: undefined, promotionCouponReturnedAt: returnedAt });
  }
  assert.equal(settlementCouponChange({ ...payout, activePromotionCouponId: couponId },
    { ...positive, stopped: false }, { ...zero, stopped: false }, returnedAt), undefined);
});

test('原派单人结单，两实例重试及已结单更正只记一次', { timeout: 150000 }, async (t) => {
  const { db, api, administrator, login, register, runCommand, seedClub, restartServer, startPeer } =
    await startClubSystem(t, { database: 'club_settlement_close_e2e', adminUsername: 'close_admin' });
  const leader = await login('employee', 'close_admin');
  const dispatcher = await register('close_dispatcher', 'employee');
  const sender = await register('close_sender', 'employee');
  const deputy = await register('close_deputy', 'employee');
  const customer = await register('close_customer', 'client');
  await runCommand('dist/src/commands/club.js', 'init-leader', leader.id);
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('member', sender.id, 'active', 'member');
  await seedClub('member', deputy.id, 'active', 'member');
  await seedClub('position', deputy.id, 'deputy');
  await seedClub('grant', administrator.id, 'CLUB_FINANCE_READ');

  const call = (app, actor, path, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200, server) =>
    api(app, `/${app}${path}`, { token: actor.token, method, body, status, server });
  const employee = (actor, path, ...args) => call('employee', actor, '/club' + path, ...args);
  const admin = (path, ...args) => call('admin', administrator, '/club' + path, ...args);
  const client = (path, ...args) => call('client', customer, path, ...args);
  const personal = actor => employee(actor, '/balance');
  const team = () => admin('/balance');
  await admin('/commission-rule', { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  await call('employee', sender, '/songxinhao', { name: '结单测试送心号' });
  const [account] = await call('employee', sender, '/songxinhao/linkable');
  const { id } = await client('/orders', { requestId: randomUUID(), dispatcherUserId: dispatcher.id,
    recipientGameAccount: '结单走查老板', requestedGiftTimes: 2 });
  const order = '/orders/' + id;
  const settlement = order + '/settlement';
  await employee(dispatcher, order + '/pricing', {
    expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
    giftSegments: [{ period: 'normal', paidGiftTimes: 2, dailyGiftTimes: 2, unitPriceCents: 60 }],
  }, 'PATCH');
  const receiptId = randomUUID();
  await employee(dispatcher, order + '/receipts', {
    requestId: receiptId, pricingRevision: 1, receivedAmountCents: 120, receivedAt: '2026-10-31T00:00:00+08:00',
  });
  await employee(dispatcher, order + '/publish', {
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, startDate: '2026-11-01', endDate: '2026-11-01', openToClaim: true, directed: [] }],
  });
  await employee(dispatcher, settlement + '/close', { requestId: randomUUID(), calculationId: 'a'.repeat(64) }, 'POST', 409);
  const { shareId } = await employee(sender, '/gift-claims/' + id, {
    requestId: randomUUID(), kind: 'public', segmentIndex: 0, dailyGiftTimes: 2,
  });
  const execution = `${order}/shares/${shareId}/execution-accounts`;
  const linked = await employee(sender, execution, { personalAccountId: account.id });
  const originalReportRequestId = randomUUID();
  const report = await employee(sender, `${execution}/${linked.id}/daily-reports`, {
    requestId: originalReportRequestId, businessDate: '2026-11-01', kind: 'daily',
    lines: [{ giftTimes: 2, receivedHearts: 2, period: 'normal' }],
  });
  const original = await admin(settlement);
  const { id: calculationId } = original.finalCalculation;
  assert.equal(original.status, 'ready_to_close');
  assert.equal((await personal(sender)).balanceCents, 0);
  const close = { requestId: randomUUID(), calculationId };
  await employee(sender, settlement + '/close', close, 'POST', 404);
  await employee(leader, settlement + '/close', close, 'POST', 404);
  await db.command({ collMod: 'club_orders', validator: { settlementClose: { $exists: false } } });
  await employee(dispatcher, settlement + '/close', close, 'POST', 500);
  assert.equal((await admin(settlement)).status, 'ready_to_close');
  assert.equal((await personal(sender)).balanceCents, 0);
  assert.equal((await team()).balanceCents, 0);
  await db.command({ collMod: 'club_orders', validator: {} });

  const fine = await employee(dispatcher, order + '/financial-adjustments', { requestId: randomUUID(),
    kind: 'member_penalty', memberUserId: sender.id, amountCents: 200, reason: '与结单同时核对的关联罚款' });
  const peer = await startPeer();
  const [possibleClose, repeatedClose, possibleFine] = await Promise.all([
    employee(dispatcher, settlement + '/close', close, 'POST', [201, 409], peer),
    employee(dispatcher, settlement + '/close', close, 'POST', [201, 409]),
    employee(deputy, `/financial-adjustments/${fine.id}/decision`, { expectedRevision: 1, decision: 'approved' }, 'PATCH', [200, 409]),
  ]);
  assert.ok(Boolean(possibleClose) !== Boolean(possibleFine), '闭单和改变依据的罚款批准不能都成功');
  assert.deepEqual(repeatedClose, possibleClose);
  const expectedPenalty = possibleFine ? 200 : 0;
  const ready = possibleClose ? original : await admin(settlement);
  const confirmed = possibleClose ?? await employee(dispatcher, settlement + '/close',
    { ...close, calculationId: ready.finalCalculation.id }, 'POST', 201);
  const closeInput = { requestId: confirmed.requestId, calculationId: confirmed.calculationId };
  const receipts = await Promise.all([
    employee(dispatcher, settlement + '/close', closeInput, 'POST', 201),
    employee(dispatcher, settlement + '/close', closeInput, 'POST', 201, peer),
  ]);
  assert.deepEqual(receipts, [confirmed, confirmed]);
  await employee(dispatcher, settlement + '/close', { ...closeInput, requestId: randomUUID() }, 'POST', 409);
  const closed = await admin(settlement);
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.close, confirmed);
  assert.equal(closed.finalCalculation.id, closeInput.calculationId);
  assert.equal((await personal(sender)).balanceCents, 100 - expectedPenalty);
  assert.equal((await personal(dispatcher)).balanceCents, 10);
  assert.equal((await team()).balanceCents, 10 + expectedPenalty);
  assert.equal((await client(order)).settlement.closedAt, confirmed.closedAt);
  await client(order + '/continuation-requests', { requestId: randomUUID(), period: 'normal',
    paidGiftTimes: 2, dailyGiftTimes: 2, startDate: '2026-11-05', endDate: '2026-11-05' }, 'POST', 409);

  const request = { requestId: randomUUID(), expectedVersion: 1, reason: '核对日报发现实际只送了一次',
    lines: [{ giftTimes: 1, receivedHearts: 1, period: 'normal' }] };
  const reportCorrection = `${order}/daily-reports/${report.originalId}`;
  await employee(sender, reportCorrection + '/corrections', request, 'POST', 409);
  await employee(sender, reportCorrection + '/correction-requests', { ...request, requestId: originalReportRequestId }, 'POST', 409);
  await employee(dispatcher, reportCorrection + '/correction-requests', request, 'POST', 404);
  const pending = await employee(sender, reportCorrection + '/correction-requests', request);
  assert.equal(pending.status, 'pending');
  assert.deepEqual(await employee(sender, reportCorrection + '/correction-requests', request), pending);
  assert.equal((await personal(sender)).balanceCents, 100 - expectedPenalty);
  assert.equal((await admin(settlement)).deliveredGiftTimes, 2);
  await employee(sender, '/settlement-corrections', undefined, 'GET', 403);
  assert.equal((await employee(leader, '/settlement-corrections')).records[0].requestId, pending.requestId);
  const decisionPath = row => `${settlement}/corrections/${row.requestId}/decision`;
  const approval = { expectedRevision: 1, decision: 'approved' };
  await employee(dispatcher, decisionPath(pending), approval, 'PATCH', 403);
  await seedClub('position', deputy.id, 'member');
  await employee(deputy, decisionPath(pending), approval, 'PATCH', 403, peer);
  await seedClub('position', deputy.id, 'deputy');

  // Fail between the atomic approval/ledger update and publication of the new report.
  await db.command({ collMod: 'club_daily_reports', validator: { version: { $lte: 1 } } });
  await employee(leader, decisionPath(pending), approval, 'PATCH', 500);
  assert.equal((await personal(sender)).balanceCents, 50 - expectedPenalty);
  assert.equal((await employee(sender, order + '/assignment')).giftProgress.deliveredGiftTimes, 1);
  await db.command({ collMod: 'club_daily_reports', validator: {} });
  await restartServer();
  const reviewed = await employee(leader, decisionPath(pending), approval, 'PATCH');
  assert.equal(reviewed.approvedVersion, 2);
  assert.equal(reviewed.postings.length, 3);
  await employee(deputy, decisionPath(pending), approval, 'PATCH', 409, peer);
  const amended = await admin(settlement);
  assert.equal(amended.deliveredGiftTimes, 1);
  assert.equal(amended.reports.filter(row => row.effective)[0].version, 2);
  assert.equal((await admin(settlement + '/calculations/' + confirmed.calculationId)).deliveredGiftTimes, 2);
  assert.equal((await admin(settlement + '/calculations/' + reviewed.revisedCalculationId)).deliveredGiftTimes, 1);
  assert.equal((await personal(sender)).entries.filter(row => row.correctionRequestId === pending.requestId).length, 1);

  const cashPath = settlement + '/cash-correction-requests';
  await employee(sender, cashPath, undefined, 'GET', 404);
  const applyCash = async (amount, revision, before) => {
    const point = { requestId: randomUUID(), movementRequestId: receiptId, expectedRevision: revision, correctedAmountCents: amount,
      evidence: '银行原流水号 1234', reason: '原收款金额登记差异' };
    await employee(sender, cashPath, point, 'POST', 404);
    const row = await employee(dispatcher, cashPath, point);
    assert.equal((await client(order)).settlement.cash.originalReceivedCents, before);
    const [first, second] = await Promise.all([
      employee(leader, decisionPath(row), approval, 'PATCH', [200, 409]),
      employee(deputy, decisionPath(row), approval, 'PATCH', [200, 409], peer),
    ]);
    assert.ok(Boolean(first) !== Boolean(second));
    assert.equal((first ?? second).deltaCents, amount - before);
    assert.equal((await client(order)).settlement.cash.originalReceivedCents, amount);
  };
  await applyCash(90, 1, 120);
  await applyCash(110, 2, 90);
  assert.equal((await admin(settlement)).receipt.receivedAmountCents, 120);
  assert.equal((await admin(settlement)).cash.originalReceivedCents, 110);
  assert.equal((await personal(sender)).balanceCents, 50 - expectedPenalty);
  assert.equal((await personal(dispatcher)).balanceCents, 5);
  assert.equal((await team()).balanceCents, 5 + expectedPenalty);

  const compensation = await employee(dispatcher, order + '/financial-adjustments', {
    requestId: randomUUID(), kind: 'customer_compensation', amountCents: 50, reason: '真实额外补偿',
  });
  await employee(leader, `/financial-adjustments/${compensation.id}/decision`, approval, 'PATCH');
  const compensated = await employee(dispatcher, `${order}/financial-adjustments/${compensation.id}/refunds`, {
    requestId: randomUUID(), expectedRevision: 2, amountCents: 50, occurredAt: '2026-11-01T01:00:00+08:00',
  });
  assert.equal((await team()).balanceCents, -45 + expectedPenalty);
  const compensationCorrection = await employee(dispatcher, cashPath, {
    requestId: randomUUID(), movementRequestId: compensated.refunds[0].requestId,
    expectedRevision: 1, correctedAmountCents: 30, evidence: '银行实退流水 5678', reason: '实退登记多记 20 分',
  });
  const applied = await employee(leader, decisionPath(compensationCorrection), approval, 'PATCH');
  assert.equal(applied.deltaCents, -20);
  assert.equal((await team()).balanceCents, -25 + expectedPenalty);
  assert.equal((await admin(settlement)).totals.clubNetCents, -25 + expectedPenalty);
  assert.equal((await client(order)).settlement.cash.netReceivedCents, 80);
  assert.deepEqual((await team()).entries.filter(row => row.kind.startsWith('compensation') || row.kind === 'customer_compensation')
    .map(row => row.amountCents).sort((a, b) => a - b), [-50, 20]);
});
