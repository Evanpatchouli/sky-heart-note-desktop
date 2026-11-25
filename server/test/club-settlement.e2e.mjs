import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import { startClubSystem } from './club-test-system.mjs';

test('按次结算隔离各端权限，以有效日报生成可复验的预计和最终计算单', { timeout: 150000 }, async (t) => {
  const { db, api, seedClub, administrator, register, restartServer, startPeer } =
    await startClubSystem(t, { database: 'club_settlement_e2e', adminUsername: 'settlement_admin' });
  const dispatcher = await register('settlement_host', 'employee');
  const a = await register('settlement_a', 'employee');
  const b = await register('settlement_b', 'employee');
  const customer = await register('settlement_customer', 'client');
  const outsider = await register('settlement_outsider', 'client');
  for (const actor of [administrator, dispatcher, a, b])
    await seedClub('member', actor.id, 'active', actor === dispatcher ? 'dispatcher' : 'member');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await db.collection('users').updateMany({ _id: { $in: [a.id, b.id] } }, { $set: { nickname: '同名团员' } });

  const call = (app, actor, path, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200, server) =>
    api(app, path, { token: actor.token, method, body, status, server });
  const employee = (actor, path, body, method, status) => call('employee', actor, '/employee' + path, body, method, status);
  const admin = (path, body, method, status, peer) => call('admin', administrator, '/admin/club' + path, body, method, status, peer);
  const asCustomer = (actor, path, body, method, status) => call('client', actor, '/client/orders' + path, body, method, status);
  const pathFor = (id) => '/club/orders/' + id;
  const settlement = (id) => '/orders/' + id + '/settlement';
  const history = (id, key) => settlement(id) + '/calculations/' + key;
  const rule = (expectedVersion, clubFeeCents) => admin('/commission-rule', { expectedVersion, clubFeeCents }, 'PATCH');
  await rule(0, 5);

  async function paidOrder({ requestedGiftTimes = 100, dailyGiftTimes = 10, unitPriceCents = 50,
    endDate = '2026-11-10', ruleVersion = 1, promotionalGiftTimes = 0, personalDiscountCents = 0,
    publish = true } = {}) {
    const order = await asCustomer(customer, '', {
      requestId: randomUUID(), recipientGameAccount: '老板游戏账号', requestedGiftTimes,
      dispatcherUserId: dispatcher.id, deliveryPeriodPreference: 'normal',
    });
    const path = pathFor(order.id);
    const { quote } = await employee(dispatcher, path + '/pricing', {
      expectedRevision: 0, ruleVersion, dispatchFeeCents: 5, personalDiscountCents,
      giftSegments: [{ period: 'normal', paidGiftTimes: requestedGiftTimes, dailyGiftTimes, unitPriceCents,
        ...(promotionalGiftTimes ? { promotionalGiftTimes } : {}) }],
    }, 'PATCH');
    await employee(dispatcher, path + '/receipts', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: quote.totalAmountCents,
      receivedAt: '2026-10-31T00:00:00+08:00',
    });
    if (publish) await employee(dispatcher, path + '/publish', {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion, commissionReviewRevision: 0,
      giftDispatchSegments: [
        { segmentIndex: 0, startDate: '2026-11-01', endDate, openToClaim: true, directed: [] },
        ...(promotionalGiftTimes ? [{ segmentIndex: 1, startDate: '2026-11-02', endDate: '2026-11-02', openToClaim: true, directed: [] }] : []),
      ],
    });
    return { id: order.id, path };
  }

  const personalAccounts = new Map();
  for (const actor of [dispatcher, a, b]) {
    await employee(actor, '/songxinhao', { name: '结算送心号' });
    const [account] = await employee(actor, '/songxinhao/linkable');
    personalAccounts.set(actor.id, account.id);
  }
  async function claim(actor, order, dailyGiftTimes, segmentIndex = 0) {
    const { shareId } = await employee(actor, '/club/gift-claims/' + order.id, {
      requestId: randomUUID(), kind: 'public', segmentIndex, dailyGiftTimes,
    });
    const route = order.path + '/shares/' + shareId + '/execution-accounts';
    const account = await employee(actor, route, { personalAccountId: personalAccounts.get(actor.id) });
    return route + '/' + account.id + '/daily-reports';
  }
  const line = (giftTimes, receivedHearts = giftTimes, period = 'normal') => ({ giftTimes, receivedHearts, period });
  const record = (actor, route, day, lines) => employee(actor, route, {
    requestId: randomUUID(), kind: 'daily', businessDate: '2026-11-' + String(day).padStart(2, '0'), lines,
  });
  const money = (data) => [data.dispatchFeeCents, data.clubFeeCents, data.rewardCents, data.allocatedCents];

  const order = await paidOrder();
  await admin('/settlements', undefined, 'GET', 403);
  await admin(settlement(order.id), undefined, 'GET', 403);
  await seedClub('position', administrator.id, 'leader');
  await admin(settlement(order.id), undefined, 'GET', 403);
  await seedClub('grant', administrator.id, 'CLUB_FINANCE_READ');
  await employee(a, order.path + '/settlement', undefined, 'GET', 404);
  await call('client', customer, '/employee' + order.path + '/settlement', undefined, 'GET', 403);
  await asCustomer(outsider, '/' + order.id, undefined, 'GET', 404);
  assert.equal((await admin('/settlements')).items[0].status, 'in_progress');

  const [aRoute, bRoute] = await Promise.all([claim(a, order, 5), claim(b, order, 5)]);
  const forecast = await admin(settlement(order.id));
  assert.equal(forecast.status, 'in_progress');
  assert.equal(forecast.finalCalculation, null);
  assert.deepEqual(money(forecast.planned), [500, 500, 4000, 5000]);
  assert.deepEqual(forecast.members.map(member => member.plannedRewardCents), [2000, 2000]);
  assert.equal((await employee(a, order.path + '/settlement')).member.plannedRewardCents, 2000);
  const customerForecast = (await asCustomer(customer, '/' + order.id)).settlement;
  assert.deepEqual(Object.keys(customerForecast).sort(), ['cash', 'status']);
  assert.equal(customerForecast.cash.originalReceivedCents, 5000);

  let firstReport;
  for (let day = 1; day <= 10; day++) {
    const [report] = await Promise.all([record(a, aRoute, day, [line(5)]), record(b, bRoute, day, [line(5)])]);
    firstReport ??= report;
  }
  const peer = await startPeer();
  const [final, replay] = await Promise.all([
    admin(settlement(order.id)), admin(settlement(order.id), undefined, 'GET', 200, peer),
  ]);
  assert.deepEqual(final, replay);
  assert.equal(final.status, 'ready_to_close');
  assert.equal(final.finalCalculation.version, 6);
  assert.deepEqual(final.issues, []);
  assert.equal(final.agreedGiftTimes, 100);
  assert.equal(final.deliveredGiftTimes, 100);
  assert.equal(final.actualReceivedHearts, 100);
  assert.deepEqual(money(final.totals), [500, 500, 4000, 5000]);
  assert.deepEqual(final.members.map(member => member.rewardCents), [2000, 2000]);
  const calculations = db.collection('club_settlement_calculations');
  const evidence = db.collection('club_settlement_evidence');
  assert.equal(await calculations.countDocuments(), 1);
  const own = await employee(a, order.path + '/settlement');
  assert.equal(own.member.rewardCents, 2000);
  assert.equal(own.dispatch, null);
  assert.ok(!('members' in own) && !('cash' in own) && !('clubFeeCents' in own.member));
  assert.deepEqual((await employee(dispatcher, order.path + '/settlement')).dispatch,
    { feeCents: 500, personalDiscountCents: 0, netCents: 500, plannedFeeCents: 500, plannedPersonalDiscountCents: 0, plannedNetCents: 500 });
  const customerFinal = await asCustomer(customer, '/' + order.id);
  assert.equal(customerFinal.settlement.status, 'ready_to_close');
  assert.equal(customerFinal.deliveryProgress.closedAt, null);

  const originalId = final.finalCalculation.id;
  await rule(1, 6);
  assert.deepEqual(await admin(settlement(order.id)), final);
  await db.collection('users').updateOne({ _id: a.id }, { $set: { nickname: '改名后的团员' } });
  final.memberNames[a.id] = '改名后的团员';
  assert.deepEqual(await admin(settlement(order.id)), final);
  const correctionRoute = order.path + '/daily-reports/' + firstReport.id + '/corrections';
  const correct = (expectedVersion, lines) => employee(a, correctionRoute, {
    requestId: randomUUID(), expectedVersion, reason: '核对原日报实绩', lines,
  });
  await correct(1, [line(4, null)]);
  const reopened = await admin(settlement(order.id));
  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.finalCalculation, null);
  assert.equal(reopened.previousCalculation.id, originalId);
  assert.equal(reopened.actualReceivedHearts, null);
  assert.equal(reopened.knownReceivedHearts, 95);
  assert.deepEqual(await admin(history(order.id, originalId)), final);
  const corrected = await correct(2, [line(3, 6, 'double'), line(4, null)]);
  const fixed = await admin(settlement(order.id));
  assert.equal(fixed.status, 'ready_to_close');
  assert.notEqual(fixed.finalCalculation.id, originalId);
  assert.equal(fixed.previousCalculation.id, originalId);
  assert.equal(fixed.observedGiftTimes, 102);
  assert.equal(fixed.excessGiftTimes, 2);
  assert.equal(fixed.actualReceivedHearts, null);
  assert.deepEqual(money(fixed.totals), [500, 500, 4000, 5000]);
  assert.equal(fixed.reports.find(report => report.id === corrected.id).effective, true);
  assert.equal(fixed.reports.find(report => report.id === firstReport.id).effective, false);

  const id = fixed.finalCalculation.id;
  const header = await calculations.findOne({ _id: id });
  await calculations.deleteOne({ _id: id });
  assert.ok(await evidence.findOne({ calculationId: id }));
  await admin(history(order.id, id), undefined, 'GET', 404);
  await restartServer();
  const afterRestart = await admin(settlement(order.id));
  assert.equal(afterRestart.finalCalculation.id, id);
  assert.equal(await evidence.countDocuments({ calculationId: id }), header.chunkCount);
  assert.deepEqual(await admin(history(order.id, originalId)), final);
  await admin(history(order.id, '0'.repeat(64)), undefined, 'GET', 404);
  await admin(history(order.id, 'bad-id'), undefined, 'GET', 400);
  await employee(b, order.path + '/daily-reports/' + firstReport.id + '/corrections', {
    requestId: randomUUID(), expectedVersion: 3, reason: '非本人日报', lines: [line(5)],
  }, 'POST', 404);

  // These fixtures stand in for durable P1-15 records. Hold back the
  // notification checkpoint until the initial adjusted calculation is saved.
  const adjustments = db.collection('club_financial_adjustments');
  await db.command({ collMod: adjustments.collectionName, validator: { notificationPublishedAt: { $exists: false } } });
  const linkedOrderId = new mongoose.Types.ObjectId(order.id);
  const createdAt = new Date('2026-11-11T04:00:00Z');
  const decidedAt = new Date('2026-11-11T05:00:00Z');
  const terms = { clubId: final.clubId, revision: 1, reason: '已确认异常处理测试夹具', requestedByUserId: dispatcher.id, createdAt };
  const decision = { status: 'approved', decidedByUserId: administrator.id, decidedAt };
  const { insertedIds } = await adjustments.insertMany([
    { ...terms, orderId: linkedOrderId, kind: 'customer_compensation', status: 'pending', amountCents: 500 },
    { ...terms, orderId: linkedOrderId, kind: 'member_penalty', status: 'pending', memberUserId: a.id, amountCents: 200 },
    { ...terms, orderId: linkedOrderId, kind: 'member_penalty', status: 'rejected', memberUserId: a.id, amountCents: 800 },
    { ...terms, ...decision, kind: 'member_penalty', memberUserId: a.id, amountCents: 900 },
  ]);
  const proposedAdjustments = await admin(settlement(order.id));
  assert.equal(proposedAdjustments.finalCalculation.id, id);
  assert.equal(proposedAdjustments.adjustments.length, 3);
  assert.deepEqual(money(proposedAdjustments.totals), [500, 500, 4000, 5000]);
  await adjustments.updateMany({ _id: { $in: [insertedIds[0], insertedIds[1]] } }, { $set: decision, $inc: { revision: 1 } });
  const approved = await admin(settlement(order.id));
  assert.equal(approved.status, 'review_required');
  assert.equal(approved.previousCalculation.id, id);
  assert.equal(approved.finalCalculation, null);
  assert.deepEqual([approved.cash.refundDueCents, approved.cash.refundedCents, approved.cash.refundRemainingCents,
    approved.cash.netReceivedCents, approved.totals.differenceCents], [500, 0, 500, 5000, 500]);
  assert.equal((await employee(a, order.path + '/settlement')).member.netRewardCents, 1800);
  const refundProof = amountCents => ({ requestId: randomUUID(), amountCents,
    occurredAt: new Date('2026-11-11T06:00:00Z'), recordedAt: new Date('2026-11-11T07:00:00Z'), recordedByUserId: dispatcher.id });
  await adjustments.updateOne({ _id: insertedIds[0], revision: 2 }, {
    $push: { refunds: refundProof(300) }, $inc: { revision: 1 },
  });
  const workInProgress = await admin(settlement(order.id));
  assert.equal(workInProgress.status, 'review_required');
  assert.deepEqual([workInProgress.cash.refundDueCents, workInProgress.cash.refundedCents, workInProgress.cash.refundRemainingCents], [500, 300, 200]);
  await adjustments.updateOne({ _id: insertedIds[0], revision: 3 }, {
    $push: { refunds: refundProof(200) }, $inc: { revision: 1 },
  });
  const adjusted = await admin(settlement(order.id));
  assert.equal(adjusted.status, 'ready_to_close');
  assert.notEqual(adjusted.finalCalculation.id, id);
  assert.equal(adjusted.previousCalculation.id, id);
  assert.deepEqual([adjusted.cash.netReceivedCents, adjusted.totals.allocatedCents, adjusted.totals.dispatchNetCents,
    adjusted.totals.clubNetCents, adjusted.totals.memberNetCents, adjusted.totals.customerCompensationCents,
    adjusted.totals.memberPenaltyCents], [4500, 4500, 500, 200, 3800, 500, 200]);
  assert.equal((await adjustments.findOne({ _id: insertedIds[1] })).notificationPublishedAt, undefined);
  await db.command({ collMod: adjustments.collectionName, validator: {} });
  let checkedPenalty;
  for (let i = 0; i < 100; i++) {
    checkedPenalty = await adjustments.findOne({ _id: insertedIds[1] });
    if (checkedPenalty.notificationPublishedAt) break;
    await sleep(100);
  }
  assert.ok(checkedPenalty.notificationPublishedAt instanceof Date);
  assert.equal(checkedPenalty.revision, 2);
  const afterNotice = await admin(settlement(order.id));
  assert.equal(afterNotice.finalCalculation.id, adjusted.finalCalculation.id);
  assert.deepEqual(afterNotice.cash, adjusted.cash);
  assert.deepEqual(afterNotice.totals, adjusted.totals);
  assert.deepEqual(afterNotice.adjustments, adjusted.adjustments);
  const ownAdjusted = await employee(a, order.path + '/settlement');
  assert.equal(ownAdjusted.member.rewardCents, 2000);
  assert.equal(ownAdjusted.member.penaltyCents, 200);
  assert.equal(ownAdjusted.member.netRewardCents, 1800);
  assert.equal(ownAdjusted.member.penalties.length, 1);
  const otherAdjusted = await employee(b, order.path + '/settlement');
  assert.equal(otherAdjusted.member.rewardCents, 2000);
  assert.equal(otherAdjusted.member.penaltyCents, undefined);
  const customerAdjusted = (await asCustomer(customer, '/' + order.id)).settlement;
  assert.deepEqual(Object.keys(customerAdjusted).sort(), ['cash', 'status']);
  assert.equal(customerAdjusted.cash.netReceivedCents, 4500);
  assert.equal((await admin(history(order.id, id))).cash.netReceivedCents, 5000);
  assert.equal((await admin(history(order.id, adjusted.finalCalculation.id))).adjustments.length, 2);

  const nonWorker = await register('settlement_nonworker', 'employee');
  await seedClub('member', nonWorker.id, 'active', 'member');
  await adjustments.insertMany([
    { ...terms, ...decision, orderId: linkedOrderId, kind: 'member_penalty', memberUserId: dispatcher.id, amountCents: 100 },
    { ...terms, ...decision, orderId: linkedOrderId, kind: 'member_penalty', memberUserId: nonWorker.id, amountCents: 300 },
  ]);
  const nonWorkerPenalties = await admin(settlement(order.id));
  assert.equal(nonWorkerPenalties.status, 'ready_to_close');
  assert.deepEqual([nonWorkerPenalties.totals.clubNetCents, nonWorkerPenalties.totals.memberNetCents,
    nonWorkerPenalties.totals.allocatedCents], [600, 3400, 4500]);
  const ownDispatchPenalty = await employee(dispatcher, order.path + '/settlement');
  assert.equal(ownDispatchPenalty.member, null);
  assert.deepEqual(ownDispatchPenalty.penalties.map(penalty => penalty.amountCents), [100]);
  await employee(nonWorker, order.path + '/settlement', undefined, 'GET', 404);

  const malformedPenalty = {
    ...terms, ...decision, orderId: linkedOrderId, kind: 'member_penalty', memberUserId: dispatcher.id, amountCents: 200,
  };
  await adjustments.insertMany([
    { ...malformedPenalty, decidedByUserId: null },
    { ...malformedPenalty, amountCents: 0 },
    { ...malformedPenalty, decidedAt: 'not a date' },
    { ...malformedPenalty, refunds: [refundProof(200)] },
  ]);
  const heldPenalties = await admin(settlement(order.id));
  assert.equal(heldPenalties.status, 'review_required');
  assert.ok(heldPenalties.issues.includes('adjustment_invalid'));
  assert.deepEqual(heldPenalties.totals, nonWorkerPenalties.totals);
  assert.deepEqual((await employee(dispatcher, order.path + '/settlement')).penalties, ownDispatchPenalty.penalties);

  const long = await paidOrder({ requestedGiftTimes: 1, dailyGiftTimes: 1, endDate: '2026-11-16', ruleVersion: 2 });
  const longRoute = await claim(a, long, 1);
  await record(a, longRoute, 1, [line(1)]);
  for (let day = 2; day <= 16; day++)
    await record(a, longRoute, day, Array.from({ length: 1000 }, () => line(0)));
  const large = await admin(settlement(long.id));
  assert.equal(large.status, 'ready_to_close');
  const largeId = large.finalCalculation.id;
  const parts = await evidence.countDocuments({ calculationId: largeId });
  assert.ok(parts > 1);
  await calculations.deleteOne({ _id: largeId });
  await evidence.deleteMany({ calculationId: largeId, sequence: { $gt: 0 } });
  await admin(history(long.id, largeId), undefined, 'GET', 404);
  const rebuilt = await admin(settlement(long.id), undefined, 'GET', 200, peer);
  assert.equal(rebuilt.finalCalculation.id, largeId);
  assert.equal(await evidence.countDocuments({ calculationId: largeId }), parts);
  assert.deepEqual(await admin(history(long.id, largeId)), rebuilt);

  await rule(2, 5);
  const financeRowFor = async (id) => (await admin('/settlements')).items.find(row => row.orderId === id);
  const personalBalance = actor => employee(actor, '/club/balance');
  const balances = () => Promise.all([personalBalance(dispatcher), personalBalance(a), personalBalance(b), admin('/balance')]);
  const closeOrder = (order, input, server) => call('employee', dispatcher, '/employee' + order.path + '/settlement/close',
    input, 'POST', 201, server);
  function postedAmounts(balance, order, close) {
    return balance.entries.filter(row => row.orderId === order.id).map(row => {
      assert.equal(row.calculationId, close.calculationId);
      assert.equal(row.occurredAt, close.closedAt);
      return [row.kind, row.amountCents];
    }).sort(([left], [right]) => left.localeCompare(right));
  }

  const openingBalances = await balances();
  const ordinary = await paidOrder({ dailyGiftTimes: 100, endDate: '2026-11-01', ruleVersion: 3 });
  const [ordinaryA, ordinaryB] = await Promise.all([claim(a, ordinary, 50), claim(b, ordinary, 50)]);
  await Promise.all([record(a, ordinaryA, 1, [line(50)]), record(b, ordinaryB, 1, [line(50)])]);
  const ordinaryReady = await admin(settlement(ordinary.id));
  assert.equal((await financeRowFor(ordinary.id)).status, 'ready_to_close');
  assert.deepEqual([ordinaryReady.deliveredGiftTimes, ordinaryReady.pricing.basis, ordinaryReady.segments[0].quote.unitPriceCents,
    ordinaryReady.pricing.dispatchFeeCents, ordinaryReady.pricing.clubFeeCents], [100, 'gift_times', 50, 5, 5]);
  assert.equal(ordinaryReady.cash.originalReceivedCents, 5000);
  assert.equal(ordinaryReady.cash.netReceivedCents, 5000);
  assert.deepEqual([ordinaryReady.totals.dispatchNetCents, ordinaryReady.totals.clubNetCents,
    ...ordinaryReady.members.map(member => member.rewardCents), ordinaryReady.totals.differenceCents], [500, 500, 2000, 2000, 0]);
  assert.deepEqual(await balances(), openingBalances);
  const ordinaryClose = await closeOrder(ordinary, { requestId: randomUUID(), calculationId: ordinaryReady.finalCalculation.id });
  assert.equal(ordinaryClose.closedByUserId, dispatcher.id);
  assert.deepEqual((await financeRowFor(ordinary.id)).close, ordinaryClose);
  const ordinaryClosed = await admin(settlement(ordinary.id));
  assert.equal(ordinaryClosed.status, 'closed');
  assert.deepEqual(ordinaryClosed.close, ordinaryClose);
  const ordinaryBalances = await balances();
  assert.deepEqual(ordinaryBalances.map((balance, index) => balance.balanceCents - openingBalances[index].balanceCents), [500, 2000, 2000, 500]);
  assert.deepEqual(ordinaryBalances.map(balance => postedAmounts(balance, ordinary, ordinaryClose)),
    [[['dispatch_fee', 500]], [['member_reward', 2000]], [['member_reward', 2000]], [['club_fee', 500]]]);

  await admin('/promotions', { expectedVersion: 0, activityName: '九折活动', activityPayableBasisPoints: 9000 }, 'PATCH');
  async function completePromotion() {
    const order = await paidOrder({
      dailyGiftTimes: 100, endDate: '2026-11-01', ruleVersion: 3, promotionalGiftTimes: 5, personalDiscountCents: 500,
    });
    const paid = await claim(a, order, 100);
    const giftA = await claim(a, order, 2, 1);
    const giftDispatcher = await claim(dispatcher, order, 3, 1);
    await record(a, paid, 1, [line(100)]);
    const onlyGiftsLeft = await admin(settlement(order.id));
    assert.equal(onlyGiftsLeft.status, 'in_progress');
    assert.equal(onlyGiftsLeft.totals.differenceCents, 0);
    await Promise.all([record(a, giftA, 2, [line(2)]), record(dispatcher, giftDispatcher, 2, [line(3)])]);
    return { order, calculation: await admin(settlement(order.id)) };
  }
  const { order: promotional, calculation: promoted } = await completePromotion();
  assert.equal(promoted.status, 'ready_to_close');
  assert.equal(promoted.deliveredGiftTimes, 105);
  assert.deepEqual(money(promoted.totals), [525, 525, 4200, 4000]);
  assert.deepEqual([promoted.totals.personalDiscountCents, promoted.totals.platformDiscountCents, promoted.totals.promotionalGiftCostCents,
    promoted.totals.dispatchNetCents, promoted.totals.clubNetCents, promoted.cash.netReceivedCents], [500, 500, 250, 25, -225, 4000]);
  assert.equal(promoted.members.find(member => member.userId === a.id).segments.length, 2);
  const self = await employee(dispatcher, promotional.path + '/settlement');
  assert.equal(self.member.rewardCents, 120);
  assert.equal(self.dispatch.netCents, 25);
  assert.equal((await employee(a, promotional.path + '/settlement')).member.rewardCents, 4080);
  const promotionInput = { requestId: randomUUID(), calculationId: promoted.finalCalculation.id };
  const [promotionClose, duplicateClose] = await Promise.all([closeOrder(promotional, promotionInput), closeOrder(promotional, promotionInput, peer)]);
  assert.deepEqual(duplicateClose, promotionClose);
  assert.deepEqual((await financeRowFor(promotional.id)).close, promotionClose);
  const promotionBalances = await balances();
  assert.deepEqual(promotionBalances.map((balance, index) => balance.balanceCents - ordinaryBalances[index].balanceCents), [145, 4080, 0, -225]);
  const [paidDispatcher, paidSender, , clubBalance] = promotionBalances;
  assert.deepEqual(postedAmounts(paidDispatcher, promotional, promotionClose),
    [['dispatch_fee', 525], ['member_reward', 120], ['personal_discount', -500]]);
  assert.deepEqual(postedAmounts(paidSender, promotional, promotionClose), [['member_reward', 4080]]);
  const financeMember = await admin(`/balance/members/${dispatcher.id}`);
  assert.deepEqual(postedAmounts(financeMember, promotional, promotionClose),
    [['dispatch_fee', 525], ['member_reward', 120], ['personal_discount', -500]]);
  assert.deepEqual(postedAmounts(clubBalance, promotional, promotionClose),
    [['club_fee', 525], ['platform_discount', -500], ['promotional_gift', -250]]);
  assert.equal(financeMember.balanceCents, paidDispatcher.balanceCents);

  const { order: extendable, calculation: beforeContinuation } = await completePromotion();
  const continuationId = randomUUID();
  const continuation = '/continuation-quotes/' + continuationId;
  const window = { startDate: '2026-11-03', endDate: '2026-11-03' };
  await employee(dispatcher, extendable.path + '/continuation-quotes', {
    requestId: continuationId, segment: { period: 'double', paidGiftTimes: 5, dailyGiftTimes: 5, unitPriceCents: 80 }, window,
  });
  const proposed = await admin(settlement(extendable.id));
  assert.equal(proposed.finalCalculation.id, beforeContinuation.finalCalculation.id);
  await asCustomer(customer, '/' + extendable.id + continuation + '/acceptance', { requestId: randomUUID() });
  const accepted = await admin(settlement(extendable.id));
  assert.equal(accepted.status, 'review_required');
  assert.deepEqual(accepted.issues, ['continuation_payment_pending']);
  await employee(dispatcher, extendable.path + continuation + '/receipt', {
    requestId: randomUUID(), receivedAmountCents: 400, receivedAt: '2026-11-02T08:00:00+08:00',
  });
  const extended = await admin(settlement(extendable.id));
  assert.equal(extended.status, 'in_progress');
  assert.equal(extended.cash.continuationReceivedCents, 400);
  assert.equal(extended.receipt.quote.revision, beforeContinuation.receipt.quote.revision);
  await employee(dispatcher, extendable.path + '/gift-dispatch', {
    requestId: randomUUID(), segments: [{ segmentIndex: 2, ...window, openToClaim: true, directed: [] }],
  });
  const continuationWork = await claim(a, extendable, 5, 2);
  await record(a, continuationWork, 3, [line(5, 10, 'double')]);
  const continued = await admin(settlement(extendable.id));
  assert.equal(continued.status, 'ready_to_close');
  assert.deepEqual(money(continued.totals), [550, 550, 4550, 4400]);
  assert.equal(continued.actualReceivedHearts, 115);
  await admin('/promotions', { expectedVersion: 1 }, 'PATCH');
  const initiateStop = async order => {
    const stop = await asCustomer(customer, '/' + order.id + '/termination', { requestId: randomUUID(), confirmed: true, reason: '老板停止剩余服务' });
    return employee(dispatcher, order.path + '/termination/changes', {
      requestId: randomUUID(), expectedRevision: stop.revision, reason: '登记老板提出的停送原因',
    });
  };
  const refund = (order, stop, amountCents, minute) => employee(dispatcher, order.path + '/termination/refunds', {
    requestId: randomUUID(), expectedRevision: stop.revision, terminationId: stop.id, confirmed: true,
    amountCents, occurredAt: `2026-11-11T08:${minute}:00+08:00`,
  });
  const partial = await paidOrder({ ruleVersion: 3 });
  const [partialA, partialB] = await Promise.all([claim(a, partial, 5), claim(b, partial, 5)]);
  for (let day = 1; day <= 8; day++)
    await Promise.all([record(a, partialA, day, [line(5)]), record(b, partialB, day, [line(5)])]);
  const stop = await initiateStop(partial);
  const due = await admin(settlement(partial.id));
  assert.equal(due.status, 'review_required');
  assert.deepEqual([due.cash.originalReceivedCents, due.cash.refundDueCents, due.cash.refundedCents, due.cash.refundRemainingCents],
    [5000, 1000, 0, 1000]);
  const partRefunded = await refund(partial, stop, 600, '00');
  const half = await admin(settlement(partial.id));
  assert.deepEqual([half.cash.refundedCents, half.cash.refundRemainingCents, half.cash.netReceivedCents], [600, 400, 4400]);
  assert.equal(half.finalCalculation, null);
  await refund(partial, partRefunded, 400, '01');
  const refunded = await admin(settlement(partial.id));
  assert.equal(refunded.status, 'ready_to_close');
  assert.deepEqual(money(refunded.totals), [400, 400, 3200, 4000]);
  assert.deepEqual(refunded.members.map(member => member.rewardCents), [1600, 1600]);
  assert.deepEqual([refunded.cash.refundedCents, refunded.cash.refundRemainingCents, refunded.cash.netReceivedCents], [1000, 0, 4000]);

  const unpublished = await paidOrder({ ruleVersion: 3, publish: false });
  await admin(settlement(unpublished.id), undefined, 'GET', 404);
  const unlisted = await initiateStop(unpublished);
  const prePublicationDue = await admin(settlement(unpublished.id));
  assert.equal(prePublicationDue.status, 'review_required');
  assert.equal(prePublicationDue.publishedAt, null);
  assert.equal(prePublicationDue.pricing, null);
  assert.equal(prePublicationDue.receipt.quote.giftSegments[0].unitPriceCents, 50);
  assert.deepEqual([prePublicationDue.cash.originalReceivedCents, prePublicationDue.cash.refundDueCents], [5000, 5000]);
  await refund(unpublished, unlisted, 5000, '02');
  const prePublicationRefund = await admin(settlement(unpublished.id));
  assert.ok(prePublicationRefund.finalCalculation);
  assert.equal(prePublicationRefund.status, 'ready_to_close');
  assert.deepEqual(money(prePublicationRefund.planned), [null, null, null, 5000]);
  assert.deepEqual(money(prePublicationRefund.totals), [0, 0, 0, 0]);
  const financeRow = (await admin('/settlements')).items.find(row => row.orderId === unpublished.id);
  assert.equal(financeRow.status, 'ready_to_close');
  const customerRefund = (await asCustomer(customer, '/' + unpublished.id)).settlement;
  assert.equal(customerRefund.status, 'ready_to_close');
  assert.deepEqual(customerRefund.cash, prePublicationRefund.cash);
  assert.deepEqual(customerRefund.termination.refunds, prePublicationRefund.termination.refunds.map(({ amountCents, occurredAt }) => ({ amountCents, occurredAt })));
  assert.deepEqual((await employee(dispatcher, unpublished.path + '/settlement')).termination, prePublicationRefund.termination);
  assert.equal((await employee(a, partial.path + '/settlement')).termination, undefined);
  await asCustomer(outsider, '/' + unpublished.id, undefined, 'GET', 404);
  await employee(a, unpublished.path + '/settlement', undefined, 'GET', 404);

  await seedClub('revoke', administrator.id, 'CLUB_FINANCE_READ');
  await admin('/settlements', undefined, 'GET', 403);
  await admin(history(order.id, originalId), undefined, 'GET', 403);
});
