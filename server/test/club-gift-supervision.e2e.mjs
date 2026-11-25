import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const employee = '/employee/clubs/supervision';
const client = '/client/clubs/supervision/orders';
const date = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
const objectId = (value) => new mongoose.Types.ObjectId(value);

test('按次监督、老板的三类实收观察、未结原单续段和历史按颗进度', { timeout: 120000 }, async (t) => {
  const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.supervision.test`]));
  const { db, base, password, runCommand } = await startSystem(t, {
    database: 'gift_supervision_e2e', adminUsername: 'supervision_admin', origins,
  });
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);
  const challenges = new Map();
  async function call(app, path, actor, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200) {
    const headers = { origin: origins[app] };
    if (actor?.token) headers.authorization = `Bearer ${actor.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (path.startsWith('/user/') && challenges.has(app)) headers.cookie = challenges.get(app);
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path} ${JSON.stringify(result)}`);
    if (path.startsWith('/captcha/')) {
      const cookie = response.headers.getSetCookie().find(item => item.startsWith('sky_captcha_'));
      challenges.set(app, cookie.split(';')[0]);
    }
    return result.data;
  }
  async function login(app, username) {
    await call(app, `/captcha/login?app=${app}`);
    return call(app, '/user/login?type=account', null, { app, username, password, captcha: captchaCode });
  }
  async function customer(username) {
    await call('client', '/captcha/register?app=client');
    await call('client', '/user/register?type=account', null, { app: 'client', username, password, captcha: captchaCode });
    return login('client', username);
  }
  const operator = await login('employee', 'supervision_admin');
  const administrator = await login('admin', 'supervision_admin');
  const owner = await customer('supervision_owner');
  const outsider = await customer('supervision_outsider');
  await configure('club', 'supervision', '履约监督');
  await configure('member', 'supervision', operator.id, 'active', 'dispatcher');
  await configure('grant', 'supervision', administrator.id, 'CLUB_COMMISSION_MANAGE');
  const rule = (expectedVersion, clubFeeCents) => call('admin', '/admin/clubs/supervision/commission-rule', administrator,
    { expectedVersion, clubFeeCents }, 'PATCH');
  await rule(0, 5);
  const invitation = async username => {
    const { invitationUrl } = await call('employee', `${employee}/member-invitations`, operator, {});
    const token = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('token');
    await call('client', '/client/club-invitations/register', null, { token, username, password });
    return login('employee', username);
  };
  const member = await invitation('supervision_executor');
  const substitute = await invitation('supervision_substitute');
  const ep = (path, actor, body, method, status) => call('employee', path, actor, body, method, status);
  const cp = (path, actor, body, method, status) => call('client', path, actor, body, method, status);
  async function publish(source, segments, window, customer = owner) {
    const giftSegments = Array.isArray(segments) ? segments : [segments];
    const requested = { requestId: randomUUID(),
      requestedGiftTimes: giftSegments.reduce((total, segment) => total + segment.paidGiftTimes, 0),
      recipientGameAccount: `${source} 的游戏号`, deliveryPeriodPreference: giftSegments.length > 1 ? 'split' : giftSegments[0].period,
      ...(giftSegments.length > 1 ? { doubleGiftTimes: giftSegments.filter(segment => segment.period === 'double')
        .reduce((total, segment) => total + segment.paidGiftTimes, 0) } : {}),
    };
    const order = source === 'direct_dispatch'
      ? await ep(`${employee}/orders`, operator, { ...requested, existingCustomerUserId: customer.id })
      : await cp(client, customer, { ...requested, dispatcherUserId: operator.id });
    const path = `${employee}/orders/${order.id}`;
    const { quote } = await ep(path + '/pricing', operator, {
      ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 5, giftSegments,
    }, 'PATCH');
    await ep(path + '/receipts', operator, {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: quote.totalAmountCents, receivedAt: '2026-11-18T08:00:00Z',
    });
    await ep(path + '/publish', operator, { requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1,
      commissionReviewRevision: 0, giftDispatchSegments: giftSegments.map((_, segmentIndex) => ({ segmentIndex, ...window, openToClaim: true, directed: [] })) });
    return { id: order.id, path, customerPath: `${client}/${order.id}`, claimPath: `${employee}/gift-claims/${order.id}` };
  }
  const read = order => cp(order.customerPath, owner);
  const giftProgress = async order => (await read(order)).deliveryProgress;
  const claim = (order, fields, actor = member) =>
    ep(order.claimPath, actor, { requestId: randomUUID(), segmentIndex: 0, kind: 'public', ...fields });
  const order = await publish('direct_dispatch', { period: 'double', paidGiftTimes: 8, dailyGiftTimes: 2, unitPriceCents: 50 },
    { startDate: date[0], endDate: date[3] });
  const continuationOrder = await publish('client_order', { period: 'normal', paidGiftTimes: 2, dailyGiftTimes: 2, unitPriceCents: 50 },
    { startDate: date[0], endDate: date[0] });
  await cp(order.customerPath, outsider, undefined, 'GET', 404);
  await cp(continuationOrder.customerPath, outsider, undefined, 'GET', 404);
  await ep(order.path + '/fulfillment', member, undefined, 'GET', 404);
  const share1 = (await claim(order, { dailyGiftTimes: 1, actualReceivedHearts: 0 })).shareId;
  const share2 = (await claim(order, { dailyGiftTimes: 2 })).shareId;
  const continuationOriginal = (await claim(continuationOrder, { dailyGiftTimes: 2 })).shareId;
  await ep('/employee/songxinhao', member, { name: '仅承接人可见的执行号' });
  const [personal] = await ep('/employee/songxinhao/linkable', member);
  const accounts = (target, shareId) => `${target.path}/shares/${shareId}/execution-accounts`;
  const link = (target, shareId) => ep(accounts(target, shareId), member, { personalAccountId: personal.id });
  const execution = await link(order, share1);
  await link(order, share2);
  const originalAccount = await link(continuationOrder, continuationOriginal);
  const report = (target, shareId, accountId, businessDate, lines, kind = 'daily') => ep(
    `${accounts(target, shareId)}/${accountId}/daily-reports`, member,
    { requestId: randomUUID(), businessDate, lines, kind, ...(kind === 'supplement' ? { reason: '照记录补报' } : {}) },
  );
  const dayOne = await report(order, share1, execution.id, date[0], [{ giftTimes: 2, receivedHearts: null }]);
  await report(order, share1, execution.id, date[1], [{ giftTimes: 0, receivedHearts: 0 }]);
  const supervision = through => ep(`${order.path}/fulfillment?through=${through}`, operator);
  const past = await supervision(date[1]);
  const [person] = past.segments[0].members;
  assert.deepEqual(person.days.map(day => day.status), ['on_track', 'reported_zero', 'future', 'future']);
  assert.deepEqual(person.shares.find(share => share.shareId === share2).days.map(day => day.status), ['missing', 'missing', 'future', 'future']);
  const queue = `${employee}/orders/fulfillment-exceptions?through=${date[0]}`;
  const queueItems = (await ep(queue, operator)).items;
  const queued = queueItems.find(item => item.order.id === order.id);
  assert.deepEqual(queued.fulfillment.segments[0].members[0].shares.map(share => share.shareId), [share2]);
  const unreported = queueItems.find(item => item.order.id === continuationOrder.id);
  assert.equal(unreported.fulfillment.segments[0].members[0].shares[0].days[0].status, 'missing');
  assert.deepEqual((await ep(queue, member)).items, []);
  await ep(`${order.path}/fulfillment?through=2026-02-30`, operator, undefined, 'GET', 400);
  assert.deepEqual(await giftProgress(order), {
    priceUnit: 'gift_times', agreedGiftTimes: 8, deliveredGiftTimes: 2, remainingGiftTimes: 6, actualReceivedHearts: null,
    estimatedReceivedHearts: 16, claimObservedReceivedHearts: [0], unknownClaimObservations: 1,
    knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, closedAt: null, fulfillmentStatus: 'in_progress', canRequestContinuation: true,
    observedGiftTimes: 2, excessGiftTimes: 0, estimatedDeliveredHearts: 4, heartAmountCents: 100, periodOnlyDifferenceCents: 0,
    periods: [{ period: 'double', observedGiftTimes: 2, deliveredGiftTimes: 2, estimatedDeliveredHearts: 4,
      actualReceivedHearts: null, knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, heartAmountCents: 100 }],
    segments: [{
      segmentIndex: 0, period: 'double', paidGiftTimes: 8, dailyGiftTimes: 2, unitPriceCents: 50, agreedGiftTimes: 8,
      deliveredGiftTimes: 2, remainingGiftTimes: 6, actualReceivedHearts: null, estimatedReceivedHearts: 16,
      knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, claimObservedReceivedHearts: [0], unknownClaimObservations: 1,
      observedGiftTimes: 2, excessGiftTimes: 0, estimatedDeliveredHearts: 4, heartAmountCents: 100,
      periods: [{ period: 'double', observedGiftTimes: 2, deliveredGiftTimes: 2, estimatedDeliveredHearts: 4,
        actualReceivedHearts: null, knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, heartAmountCents: 100 }],
      window: { startDate: date[0], endDate: date[3] },
    }],
  });
  const correction = { requestId: randomUUID(), expectedVersion: 1, reason: '按份额补充已送记录', lines: [
    { giftTimes: 1, receivedHearts: 0 }, { shareId: share2, giftTimes: 1, receivedHearts: 0 },
  ] };
  const correctPath = `${order.path}/daily-reports/${dayOne.originalId}/corrections`;
  await ep(correctPath, member, correction);
  assert.equal((await giftProgress(order)).actualReceivedHearts, 0);
  assert.equal((await ep(queue, operator)).items.some(item => item.order.id === order.id), false);
  await report(order, share1, execution.id, date[2], [{ giftTimes: 1, receivedHearts: 1 }]);
  assert.equal((await supervision(date[2])).segments[0].members[0].days[2].status, 'short');
  await report(order, share1, execution.id, date[3], [{ giftTimes: 1, receivedHearts: 2 }], 'supplement');
  assert.equal((await supervision(date[1])).deliveredGiftTimes, 2);
  assert.equal((await giftProgress(order)).deliveredGiftTimes, 4);
  const transfer = (shareId, giftTimes) => ep(order.path + '/gift-dispatch/reassign', operator,
    { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes });
  await transfer(share1, 1);
  await transfer(share2);
  const afterTransfer = (await supervision(date[3])).segments[0];
  const transferred = afterTransfer.members[0].shares.find(share => share.shareId === share2);
  assert.equal(transferred.agreedGiftTimes, 1);
  assert.equal(transferred.window.endDate, date[0]);
  assert.deepEqual(transferred.days.map(day => day.status), ['on_track']);
  const publicView = await read(order);
  for (const privateValue of [member.id, execution.id, '仅承接人可见的执行号', 'dispatchFeeCents', 'clubFeeCents', 'memberCents'])
    assert.equal(JSON.stringify(publicView).includes(privateValue), false);
  assert.equal((await cp('/client/orders', owner)).items.find(item => item.id === order.id).deliveryProgress.remainingGiftTimes, 4);

  await t.test('按实际游戏时段核对混合报价、单段跨期、转派和日报更正', async () => {
    const quoteWindow = { startDate: date[0], endDate: date[3] };
    const mixed = await publish('client_order', [
      { period: 'double', paidGiftTimes: 60, dailyGiftTimes: 15, unitPriceCents: 50 },
      { period: 'normal', paidGiftTimes: 40, dailyGiftTimes: 10, unitPriceCents: 50 },
    ], quoteWindow);
    const mixInitial = await read(mixed);
    assert.equal(mixInitial.deliveryProgress.estimatedReceivedHearts, 160);
    assert.equal(mixInitial.quote.heartsAmountCents, 5000);
    const shares = await Promise.all([0, 1].map(segmentIndex =>
      claim(mixed, { segmentIndex, dailyGiftTimes: 2 })));
    const mixedAccount = await link(mixed, shares[0].shareId);
    assert.equal((await link(mixed, shares[1].shareId)).id, mixedAccount.id);
    await report(mixed, shares[0].shareId, mixedAccount.id, date[0], [
      { shareId: shares[0].shareId, period: 'double', giftTimes: 2, receivedHearts: 4 },
      { shareId: shares[1].shareId, period: 'normal', giftTimes: 2, receivedHearts: 2 },
    ]);
    const mixedProgress = await giftProgress(mixed);
    assert.deepEqual([mixedProgress.deliveredGiftTimes, mixedProgress.actualReceivedHearts, mixedProgress.remainingGiftTimes], [4, 6, 96]);
    assert.deepEqual(mixedProgress.periods.map(({ period, deliveredGiftTimes, actualReceivedHearts }) =>
      [period, deliveredGiftTimes, actualReceivedHearts]), [['normal', 2, 2], ['double', 2, 4]]);

    const crossing = await publish('direct_dispatch', { period: 'normal', paidGiftTimes: 5, dailyGiftTimes: 5, unitPriceCents: 50 },
      { startDate: date[0], endDate: date[0] });
    const initial = await read(crossing);
    const { shareId } = await claim(crossing, { dailyGiftTimes: 5, actualReceivedHearts: 9 });
    const account = await link(crossing, shareId);
    const original = await report(crossing, shareId, account.id, date[0], [
      { period: 'normal', giftTimes: 2, receivedHearts: 2 },
      { period: 'double', giftTimes: 2, receivedHearts: 4 },
    ]);
    const supervisionPath = crossing.path + '/fulfillment';
    const inspect = () => ep(`${supervisionPath}?through=${date[0]}`, operator);
    const memberProgress = async () => (await ep(crossing.path + '/daily-reports', member)).giftProgress;
    const sameDay = await inspect();
    assert.equal(sameDay.segments[0].period, 'normal');
    assert.equal(sameDay.segments[0].members[0].shares[0].days[0].reportedGiftTimes, 4);
    assert.deepEqual(sameDay.periods, (await memberProgress()).segments[0].periods);
    assert.deepEqual([sameDay.deliveredGiftTimes, sameDay.actualReceivedHearts, sameDay.estimatedDeliveredHearts], [4, 6, 6]);
    assert.deepEqual(sameDay.claimObservedReceivedHearts, [9]);
    await ep(crossing.path + '/gift-dispatch/reassign', operator,
      { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes: 2 }, 'POST', 409);
    await ep(crossing.path + '/gift-dispatch/reassign', operator,
      { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes: 1 });
    const correctionPath = `${crossing.path}/daily-reports/${original.originalId}/corrections`;
    const correct = (expectedVersion, lines) => ep(correctionPath, member,
      { requestId: randomUUID(), expectedVersion, reason: '复核实际游戏时段和到账', lines });
    await correct(1, [{ period: 'double', giftTimes: 4, receivedHearts: 8 }]);
    const allDouble = await memberProgress();
    assert.deepEqual(allDouble.pendingCompensation, { giftTimes: 4, grossCents: 200, dispatchFeeCents: 20, clubFeeCents: 20, memberCents: 160 });
    assert.deepEqual([allDouble.estimatedReceivedHearts, allDouble.estimatedDeliveredHearts, allDouble.actualReceivedHearts, allDouble.remainingGiftTimes], [5, 8, 8, 0]);
    const unchanged = await read(crossing);
    assert.deepEqual(unchanged.quote, initial.quote);
    assert.deepEqual(unchanged.receipt, initial.receipt);
    assert.equal(unchanged.deliveryProgress.periodOnlyDifferenceCents, 0);
    assert.equal((await inspect()).remainingGiftTimes, 1);

    await correct(2, [{ period: 'double', giftTimes: 3, receivedHearts: 0 }, { period: 'unconfirmed', giftTimes: 1, receivedHearts: null }]);
    const uncertain = await giftProgress(crossing);
    assert.deepEqual([uncertain.estimatedDeliveredHearts, uncertain.actualReceivedHearts, uncertain.unknownReceivedLines], [null, null, 1]);
    assert.deepEqual(uncertain.periods.map(({ period, actualReceivedHearts, estimatedDeliveredHearts, knownReceivedLines }) =>
      [period, actualReceivedHearts, estimatedDeliveredHearts, knownReceivedLines]), [['double', 0, 6, 1], ['unconfirmed', null, null, 0]]);
    await correct(3, [{ period: 'normal', giftTimes: 2, receivedHearts: 2 }, { period: 'double', giftTimes: 3, receivedHearts: 6 }]);
    const excessive = await inspect();
    assert.deepEqual([excessive.observedGiftTimes, excessive.deliveredGiftTimes, excessive.excessGiftTimes, excessive.actualReceivedHearts, excessive.heartAmountCents], [5, 4, 1, 8, 200]);
    assert.deepEqual(excessive.periods.map(row => [row.period, row.deliveredGiftTimes, row.heartAmountCents]),
      [['normal', null, null], ['double', null, null]]);

    const tail = await publish('direct_dispatch', { period: 'normal', paidGiftTimes: 1, dailyGiftTimes: 1, unitPriceCents: 50 },
      { startDate: date[0], endDate: date[0] });
    const tailShare = (await claim(tail, { dailyGiftTimes: 1 })).shareId;
    const tailAccount = await link(tail, tailShare);
    await report(tail, tailShare, tailAccount.id, date[0], [{ period: 'double', giftTimes: 1, receivedHearts: 2 }]);
    const last = await giftProgress(tail);
    assert.deepEqual([last.deliveredGiftTimes, last.remainingGiftTimes, last.actualReceivedHearts, last.heartAmountCents, last.periodOnlyDifferenceCents], [1, 0, 2, 50, 0]);
  });

  await report(continuationOrder, continuationOriginal, originalAccount.id, date[0], [{ giftTimes: 2, receivedHearts: 2 }]);
  const completed = await giftProgress(continuationOrder);
  assert.equal(completed.fulfillmentStatus, 'completed');
  assert.equal(completed.closedAt, null);
  assert.equal(completed.canRequestContinuation, true);
  await rule(1, 7);
  const { customerPath, path } = continuationOrder;
  const requested = { requestId: randomUUID(), period: 'double', paidGiftTimes: 5, dailyGiftTimes: 3,
    startDate: date[2], endDate: date[3] };
  await cp(customerPath + '/continuation-requests', outsider, requested, 'POST', 404);
  await cp(customerPath + '/continuation-requests', owner, { ...requested, unitPriceCents: 1 }, 'POST', 400);
  const request = await cp(customerPath + '/continuation-requests', owner, requested);
  assert.deepEqual(await cp(customerPath + '/continuation-requests', owner, requested), request);
  const quotation = { requestId: randomUUID(), customerRequestId: request.requestId,
    segment: { period: 'double', paidGiftTimes: 5, dailyGiftTimes: 3, unitPriceCents: 65 } };
  await ep(path + '/continuation-quotes', member, quotation, 'POST', 404);
  const quote = await ep(path + '/continuation-quotes', operator, quotation);
  assert.deepEqual(quote.commission, { version: 1, basis: 'gift_times', dispatchFeeCents: 5, clubFeeCents: 5 });
  const quotePath = `/continuation-quotes/${quote.requestId}`;
  const acceptance = { requestId: randomUUID() };
  await cp(customerPath + quotePath + '/acceptance', outsider, acceptance, 'POST', 404);
  await cp(customerPath + quotePath + '/acceptance', owner, { ...acceptance, unitPriceCents: 1 }, 'POST', 400);
  await cp(customerPath + quotePath + '/acceptance', owner, acceptance);
  assert.equal((await giftProgress(continuationOrder)).agreedGiftTimes, 2);
  assert.equal((await read(continuationOrder)).continuationQuotes[0].receipt, undefined);
  assert.equal((await ep(path + '/gift-dispatch', operator)).quotes.length, 1);
  const receipt = { requestId: randomUUID(), receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00Z' };
  await ep(path + quotePath + '/receipt', operator, { ...receipt, receivedAmountCents: 324 }, 'POST', 409);
  const paid = () => ep(path + quotePath + '/receipt', operator, receipt);
  assert.deepEqual(await Promise.all([paid(), paid()]), [
    { receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00.000Z', segmentIndex: 1 },
    { receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00.000Z', segmentIndex: 1 },
  ]);
  const extended = await read(continuationOrder);
  assert.equal(extended.quote.totalAmountCents, 100);
  assert.equal(extended.continuationQuotes[0].receipt.receivedAmountCents, 325);
  assert.deepEqual(extended.deliveryProgress.segments.map(segment => segment.unitPriceCents), [50, 65]);
  assert.equal(extended.deliveryProgress.agreedGiftTimes, 7);
  assert.equal(extended.deliveryProgress.remainingGiftTimes, 5);
  const segment = { segmentIndex: 1, startDate: date[2], endDate: date[3], openToClaim: true, directed: [] };
  await ep(path + '/gift-dispatch', operator, { requestId: randomUUID(), segments: [{ ...segment, startDate: date[1] }] }, 'POST', 400);
  await ep(path + '/gift-dispatch', operator, { requestId: randomUUID(), segments: [segment] });
  const second = await claim(continuationOrder, { segmentIndex: 1, dailyGiftTimes: 3 });
  const secondAccount = await link(continuationOrder, second.shareId);
  await report(continuationOrder, second.shareId, secondAccount.id, date[2], [{ period: 'double', giftTimes: 3, receivedHearts: 5 }]);
  assert.equal((await giftProgress(continuationOrder)).remainingGiftTimes, 2);
  assert.equal((await giftProgress(continuationOrder)).segments[1].periods[0].heartAmountCents, 195);
  assert.equal((await ep(path + '/daily-reports', member)).giftProgress.pendingCompensation.memberCents, 245);

  const orders = db.collection('club_orders');
  const closedAt = new Date('2026-11-24T00:00:00Z');
  await orders.updateOne({ _id: objectId(continuationOrder.id) }, { $set: { closedAt } });
  assert.equal((await giftProgress(continuationOrder)).closedAt, closedAt.toISOString());
  await cp(customerPath + '/continuation-requests', owner, { ...requested, requestId: randomUUID() }, 'POST', 409);
  assert.deepEqual(await cp(customerPath + '/continuation-requests', owner, requested), request);
  assert.equal((await paid()).segmentIndex, 1);
  await orders.updateOne({ _id: objectId(order.id) }, { $set: { closedAt } });
  await ep(correctPath, member, { ...correction, requestId: randomUUID(), expectedVersion: 2 }, 'POST', 409);
  assert.equal((await ep(correctPath, member, correction)).version, 2);
  assert.equal((await ep(order.path + '/daily-reports', member)).giftProgress.canCorrectReports, false);

  const historical = objectId();
  const historicalShare = objectId();
  await orders.insertOne({ _id: historical, clubId: 'supervision', source: 'direct_dispatch', businessType: 'heart_delivery',
    requestId: randomUUID(), createdByUserId: operator.id, dispatcherUserId: operator.id,
    customerUserId: owner.id, customerLinkStatus: 'verified', dispatchStatus: 'published', recipientGameAccount: '历史老板',
    heartDelivery: { requestedHearts: 20, agreedDeadline: date[3] },
    shares: [{ _id: historicalShare, userId: member.id, hearts: 12, executionGameAccounts: [] }],
  });
  await db.collection('club_daily_reports').insertOne({ orderId: historical, shareId: historicalShare, userId: member.id,
    requestId: randomUUID(), accountId: objectId(), originalId: objectId(), version: 1, businessDate: date[0], kind: 'daily',
    receivedHearts: 11, lines: [{ giftTimes: 2, receivedHearts: 11, period: 'double' }],
  });
  const historicalView = await cp(`${client}/${historical}`, owner);
  assert.equal(historicalView.requestedGiftTimes, undefined);
  assert.equal(historicalView.requestedHearts, 20);
  assert.equal(historicalView.deliveryProgress.agreedDeadline, date[3]);
  assert.equal((await ep(`${employee}/orders/${historical}/fulfillment`, operator)).agreedDeadline, date[3]);
  assert.deepEqual([historicalView.deliveryProgress.observedHearts, historicalView.deliveryProgress.creditedHearts,
    historicalView.deliveryProgress.remainingHearts], [11, 11, 9]);
  await cp(`${client}/${historical}`, outsider, undefined, 'GET', 404);
});
