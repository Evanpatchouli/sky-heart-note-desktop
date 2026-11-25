import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
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
  assert.equal(final.finalCalculation.version, 5);
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

  // These fixtures stand in for the durable P1-15 records. Only the
  // settlement reader, roles and cash calculations are exercised here.
  const adjustments = db.collection('club_financial_adjustments');
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
  await admin('/promotions', { expectedVersion: 0, activityName: '九折活动', activityPayableBasisPoints: 9000 }, 'PATCH');
  const promotional = await paidOrder({
    dailyGiftTimes: 100, endDate: '2026-11-01', ruleVersion: 3, promotionalGiftTimes: 5, personalDiscountCents: 500,
  });
  const promotionalPaid = await claim(a, promotional, 100);
  const promotionalA = await claim(a, promotional, 2, 1);
  const promotionalDispatch = await claim(dispatcher, promotional, 3, 1);
  await record(a, promotionalPaid, 1, [line(100)]);
  const onlyGiftsLeft = await admin(settlement(promotional.id));
  assert.equal(onlyGiftsLeft.status, 'in_progress');
  assert.equal(onlyGiftsLeft.totals.differenceCents, 0);
  await Promise.all([record(a, promotionalA, 2, [line(2)]), record(dispatcher, promotionalDispatch, 2, [line(3)])]);
  const promoted = await admin(settlement(promotional.id));
  assert.equal(promoted.status, 'ready_to_close');
  assert.deepEqual(money(promoted.totals), [525, 525, 4200, 4000]);
  assert.deepEqual([promoted.totals.personalDiscountCents, promoted.totals.platformDiscountCents, promoted.totals.promotionalGiftCostCents,
    promoted.totals.dispatchNetCents, promoted.totals.clubNetCents, promoted.cash.netReceivedCents], [500, 500, 250, 25, -225, 4000]);
  assert.equal(promoted.members.find(member => member.userId === a.id).segments.length, 2);
  const self = await employee(dispatcher, promotional.path + '/settlement');
  assert.equal(self.member.rewardCents, 120);
  assert.equal(self.dispatch.netCents, 25);
  assert.equal((await employee(a, promotional.path + '/settlement')).member.rewardCents, 4080);

  const continuationId = randomUUID();
  const continuation = '/continuation-quotes/' + continuationId;
  const window = { startDate: '2026-11-03', endDate: '2026-11-03' };
  await employee(dispatcher, promotional.path + '/continuation-quotes', {
    requestId: continuationId, segment: { period: 'double', paidGiftTimes: 5, dailyGiftTimes: 5, unitPriceCents: 80 }, window,
  });
  const proposed = await admin(settlement(promotional.id));
  assert.equal(proposed.finalCalculation.id, promoted.finalCalculation.id);
  await asCustomer(customer, '/' + promotional.id + continuation + '/acceptance', { requestId: randomUUID() });
  const accepted = await admin(settlement(promotional.id));
  assert.equal(accepted.status, 'review_required');
  assert.deepEqual(accepted.issues, ['continuation_payment_pending']);
  await employee(dispatcher, promotional.path + continuation + '/receipt', {
    requestId: randomUUID(), receivedAmountCents: 400, receivedAt: '2026-11-02T08:00:00+08:00',
  });
  const extended = await admin(settlement(promotional.id));
  assert.equal(extended.status, 'in_progress');
  assert.equal(extended.cash.continuationReceivedCents, 400);
  assert.equal(extended.receipt.quote.revision, promoted.receipt.quote.revision);
  await employee(dispatcher, promotional.path + '/gift-dispatch', {
    requestId: randomUUID(), segments: [{ segmentIndex: 2, ...window, openToClaim: true, directed: [] }],
  });
  const continuationWork = await claim(a, promotional, 5, 2);
  await record(a, continuationWork, 3, [line(5, 10, 'double')]);
  const continued = await admin(settlement(promotional.id));
  assert.equal(continued.status, 'ready_to_close');
  assert.deepEqual(money(continued.totals), [550, 550, 4550, 4400]);
  assert.equal(continued.actualReceivedHearts, 115);

  // The P1-14 writer uses this persisted shape. This isolated release consumes
  // it through normal HTTP reads, while the main-tree suite runs its writers.
  await admin('/promotions', { expectedVersion: 1 }, 'PATCH');
  const persistedOrders = db.collection('club_orders');
  const stopAt = '2026-11-11T06:00:00.000Z';
  const privateReference = '线下原始停送沟通记录';
  async function persistStop(order, origin = 'customer_request') {
    const orderId = new mongoose.Types.ObjectId(order.id);
    const terminationId = new mongoose.Types.ObjectId().toHexString();
    await persistedOrders.updateOne({ _id: orderId }, {
      $set: { giftTermination: {
        id: terminationId, origin, stoppedAt: stopAt, reason: '老板停止剩余服务',
        ...(origin === 'reported_customer_request' ? { customerRequestReference: privateReference } : {}),
        change: { reason: '登记老板提出的停送原因', recordedByUserId: dispatcher.id, recordedAt: stopAt },
        refunds: [], requests: [],
      } },
      $inc: { fulfillmentRevision: 1 },
    });
    return orderId;
  }
  const refundTime = (minute) => `2026-11-11T08:${minute}:00.000Z`;
  const persistRefund = (orderId, amountCents, refundDueAtRecordingCents, minute) => persistedOrders.updateOne({ _id: orderId }, {
    $push: { 'giftTermination.refunds': {
      kind: 'refund', requestId: randomUUID(), amountCents, occurredAt: refundTime(minute),
      recordedAt: refundTime(minute), recordedByUserId: dispatcher.id, reason: '登记老板提出的停送原因',
      refundDueAtRecordingCents,
    } },
    $inc: { fulfillmentRevision: 1 },
  });

  const partial = await paidOrder({ ruleVersion: 3 });
  const [partialA, partialB] = await Promise.all([claim(a, partial, 5), claim(b, partial, 5)]);
  for (let day = 1; day <= 8; day++)
    await Promise.all([record(a, partialA, day, [line(5)]), record(b, partialB, day, [line(5)])]);
  const partialId = await persistStop(partial);
  const partialDue = await admin(settlement(partial.id));
  assert.equal(partialDue.status, 'review_required');
  assert.deepEqual([partialDue.termination.origin, partialDue.cash.refundDueCents, partialDue.cash.refundRemainingCents],
    ['customer_request', 1000, 1000]);
  assert.equal((await asCustomer(customer, '/' + partial.id)).deliveryProgress.fulfillmentStatus, 'stopped');
  await persistRefund(partialId, 600, 1000, '00');
  const partRefunded = await admin(settlement(partial.id));
  assert.equal(partRefunded.status, 'review_required');
  assert.deepEqual([partRefunded.cash.refundedCents, partRefunded.cash.refundRemainingCents, partRefunded.cash.netReceivedCents], [600, 400, 4400]);
  await persistRefund(partialId, 400, 1000, '01');
  const refunded = await admin(settlement(partial.id));
  assert.equal(refunded.status, 'ready_to_close');
  assert.deepEqual(money(refunded.totals), [400, 400, 3200, 4000]);
  assert.equal(refunded.receipt.quote.giftSegments[0].unitPriceCents, 50);
  assert.deepEqual(refunded.members.map(member => member.rewardCents), [1600, 1600]);
  const dispatchStop = await employee(dispatcher, partial.path + '/settlement');
  assert.deepEqual(dispatchStop.termination, refunded.termination);
  assert.equal((await employee(a, partial.path + '/settlement')).termination, undefined);
  const savedStop = await admin(history(partial.id, refunded.finalCalculation.id));
  assert.deepEqual(savedStop.termination.refunds, refunded.termination.refunds);

  const unpublished = await paidOrder({ ruleVersion: 3, publish: false });
  await admin(settlement(unpublished.id), undefined, 'GET', 404);
  const unpublishedId = await persistStop(unpublished, 'reported_customer_request');
  const unpublishedDue = await admin(settlement(unpublished.id));
  assert.equal(unpublishedDue.status, 'review_required');
  assert.equal(unpublishedDue.pricing, null);
  assert.equal(unpublishedDue.publishedAt, null);
  assert.deepEqual([unpublishedDue.cash.originalReceivedCents, unpublishedDue.cash.refundDueCents], [5000, 5000]);
  assert.equal(unpublishedDue.termination.customerRequestReference, privateReference);
  await persistRefund(unpublishedId, 5000, 5000, '02');
  const unpublishedRefunded = await admin(settlement(unpublished.id));
  assert.equal(unpublishedRefunded.status, 'ready_to_close');
  assert.deepEqual(money(unpublishedRefunded.planned), [null, null, null, 5000]);
  assert.deepEqual(money(unpublishedRefunded.totals), [0, 0, 0, 0]);
  assert.equal((await admin('/settlements')).items.find(row => row.orderId === unpublished.id).status, 'ready_to_close');
  const customerRefund = (await asCustomer(customer, '/' + unpublished.id)).settlement;
  assert.deepEqual(customerRefund.cash, unpublishedRefunded.cash);
  assert.deepEqual(customerRefund.termination.refunds, [{ amountCents: 5000, occurredAt: refundTime('02') }]);
  assert.equal(customerRefund.termination.customerRequestReference, undefined);
  assert.deepEqual(Object.keys(customerRefund.termination.change), ['reason']);
  await asCustomer(outsider, '/' + unpublished.id, undefined, 'GET', 404);
  await employee(a, unpublished.path + '/settlement', undefined, 'GET', 404);
  await asCustomer(customer, '/' + unpublished.id + '/termination', { requestId: randomUUID(), confirmed: true }, 'POST', 404);
  await employee(dispatcher, unpublished.path + '/termination/refunds', { requestId: randomUUID() }, 'POST', 404);

  await seedClub('revoke', administrator.id, 'CLUB_FINANCE_READ');
  await admin('/settlements', undefined, 'GET', 403);
  await admin(history(order.id, originalId), undefined, 'GET', 403);
});
