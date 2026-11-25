import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const origin = app => `https://${app}.gift.test`;
const actorPath = '/employee/clubs/gifts';
const firstDay = '2026-12-01';
const lastDay = '2026-12-10';

test('已核款订单按计价段公开或定向承接，改派保留已送事实并用一次性邀请注册', { timeout: 120000 }, async t => {
  const { db, base, password, runCommand, startPeer } = await startSystem(t, {
    database: 'club_gift_dispatch_e2e', adminUsername: 'gift_admin',
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, origin(app)])),
  });
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);

  async function request(app, path, { method = 'GET', auth, body, status = 200, cookie, server = base } = {}) {
    const headers = { origin: origin(app) };
    if (auth) headers.authorization = `Bearer ${auth.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(server + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { data: payload.data, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  }

  const get = async (auth, path, status = 200, app = 'employee') => (await request(app, path, { auth, status })).data;
  const post = async (auth, path, body, status = 201) =>
    (await request('employee', path, { method: 'POST', auth, body, status })).data;
  const write = async (app, path, method, auth, body, status = 200) =>
    (await request(app, path, { method, auth, body, status })).data;
  async function login(app, username) {
    const { cookie } = await request(app, `/captcha/login?app=${app}`);
    return (await request(app, '/user/login?type=account', {
      method: 'POST', status: 201, cookie, body: { app, username, password, captcha: captchaCode },
    })).data;
  }

  const manager = await login('admin', 'gift_admin');
  const dispatcher = await login('employee', 'gift_admin');
  await configure('club', 'gifts', '按次俱乐部');
  await configure('club', 'outside', '其他俱乐部');
  await configure('member', 'gifts', dispatcher.id, 'active', 'dispatcher');
  await configure('grant', 'gifts', manager.id, 'CLUB_COMMISSION_MANAGE');
  await write('admin', '/admin/clubs/gifts/commission-rule', 'PATCH', manager, { basis: 'gift_times', expectedVersion: 0, clubFeeCents: 3 });

  async function invite(username) {
    const { invitationUrl, expiresAt } = await post(dispatcher, actorPath + '/member-invitations');
    const url = new URL(invitationUrl);
    assert.equal(url.origin, origin('client'));
    assert.equal(url.pathname, '/join-club');
    assert.ok(expiresAt > Date.now());
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    const body = { token, username, password };
    const registration = await write('client', '/client/club-invitations/register', 'POST', undefined, body, 201);
    assert.equal(registration.employeeUrl, origin('employee'));
    assert.match(registration.id, /^[A-Z0-9]{4}$/);
    assert.equal(registration.clubId, 'gifts');
    await write('client', '/client/club-invitations/register', 'POST', undefined, { ...body, username: username + '_again' }, 409);
    const membership = await db.collection('club_members').findOne({ clubId: 'gifts', userId: registration.id });
    assert.equal(membership.active, true);
    assert.equal(membership.position, 'member');
    assert.equal(membership.dispatcher, false);
    assert.deepEqual(membership.permissions, []);
    const account = await db.collection('users').findOne({ _id: registration.id });
    const roles = await db.collection('roles').find({ _id: { $in: account.role_ids } }).toArray();
    assert.deepEqual(roles.map(role => role.role_code), ['employee']);
    return login('employee', username);
  }
  const executor = await invite('gift_executor');
  const third = await invite('gift_third');
  const fourth = await invite('gift_fourth');
  assert.deepEqual((await get(dispatcher, actorPath + '/gift-candidates')).map(({ userId }) => userId),
    [dispatcher.id, executor.id, third.id, fourth.id].sort());

  const { cookie } = await request('client', '/captcha/register?app=client');
  const { data: registered } = await request('client', '/user/register?type=account', {
    method: 'POST', status: 201, cookie, body: { app: 'client', username: 'gift_customer', password, captcha: captchaCode },
  });
  const customer = await login('client', 'gift_customer');
  const clientInput = (requestedGiftTimes, recipientGameAccount) => ({
    requestId: randomUUID(), requestedGiftTimes, recipientGameAccount, estimatedReceivedHearts: requestedGiftTimes * 2,
  });
  const quote = (paidGiftTimes, dailyGiftTimes) => ({ period: 'double', paidGiftTimes, dailyGiftTimes, unitPriceCents: 50 });
  const schedule = (segmentIndex, endDate, openToClaim = true, directed = []) =>
    ({ segmentIndex, startDate: firstDay, endDate, openToClaim, directed });
  const orderPath = id => actorPath + '/orders/' + id;
  const claimPath = id => actorPath + '/gift-claims/' + id;
  const receiptPath = (id, requestId) => claimPath(id) + '/receipts/' + requestId;
  const publishInput = (giftDispatchSegments) => ({
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    ...(giftDispatchSegments ? { giftDispatchSegments } : {}),
  });
  async function pay(id, giftSegments) {
    const pricing = await write('employee', orderPath(id) + '/pricing', 'PATCH', dispatcher, {
      ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 5, giftSegments,
    });
    assert.equal(pricing.quote.priceUnit, 'gift_times');
    return post(dispatcher, orderPath(id) + '/receipts', {
      requestId: randomUUID(), pricingRevision: 1,
      receivedAmountCents: pricing.quote.totalAmountCents, receivedAt: '2026-11-25T08:00:00Z',
    });
  }
  const claim = (actor, id, dailyGiftTimes, status = 201, input = {}) =>
    post(actor, claimPath(id), { requestId: randomUUID(), segmentIndex: 0, kind: 'public', dailyGiftTimes, ...input }, status);

  const direct = await post(dispatcher, actorPath + '/orders', {
    ...clientInput(100, 'direct recipient'), existingCustomerUserId: registered.id,
  });
  const directPublish = publishInput([schedule(0, lastDay)]);
  await claim(executor, direct.id, 5, 404);
  await post(dispatcher, orderPath(direct.id) + '/publish', directPublish, 409);
  const directPayment = await pay(direct.id, [quote(100, 10)]);
  assert.equal(directPayment.receipt.receivedAmountCents, 5000);
  await claim(executor, direct.id, 5, 404);
  await post(executor, orderPath(direct.id) + '/publish', directPublish, 404);
  const firstPublication = await post(dispatcher, orderPath(direct.id) + '/publish', directPublish);
  assert.equal(firstPublication.source, 'direct_dispatch');
  assert.equal(firstPublication.dispatchStatus, 'published');
  assert.equal((await post(dispatcher, orderPath(direct.id) + '/publish', directPublish)).publishedAt, firstPublication.publishedAt);
  await post(dispatcher, orderPath(direct.id) + '/publish', {
    ...directPublish, giftDispatchSegments: [schedule(0, '2026-12-11')],
  }, 409);

  const five = { requestId: randomUUID(), actualReceivedHearts: 0 };
  const exhausted = { requestId: randomUUID() };
  const claimed = [
    await claim(dispatcher, direct.id, 5, 201, five), await claim(executor, direct.id, 3, 201, { requestId: five.requestId }),
    await claim(third, direct.id, 5), await claim(fourth, direct.id, 5, 201, exhausted),
  ];
  assert.deepEqual(claimed.map(({ dailyGiftTimes, giftTimes }) => [dailyGiftTimes, giftTimes]), [[5, 50], [3, 30], [2, 20], [0, 0]]);
  assert.deepEqual(claimed.map(({ requestedDailyGiftTimes }) => requestedDailyGiftTimes), [5, 3, 5, 5]);
  assert.deepEqual(claimed[2].schedule, [{ startDate: firstDay, endDate: lastDay, dailyGiftTimes: 2 }]);
  assert.equal(claimed[3].shareId, undefined);
  assert.deepEqual(claimed[3].schedule, []);
  assert.equal(claimed[0].actualReceivedHearts, 0);
  assert.equal(claimed[1].actualReceivedHearts, undefined);
  assert.deepEqual(await claim(dispatcher, direct.id, 5, 201, five), claimed[0]);
  assert.deepEqual(await get(fourth, receiptPath(direct.id, exhausted.requestId)), claimed[3]);
  await claim(dispatcher, direct.id, 4, 409, five);
  await claim(executor, direct.id, 5, 409, five);
  assert.deepEqual(await get(dispatcher, receiptPath(direct.id, five.requestId.toUpperCase())), claimed[0]);
  assert.deepEqual(await get(executor, receiptPath(direct.id, five.requestId)), claimed[1]);
  await get(third, receiptPath(direct.id, five.requestId), 404);
  const own = await get(executor, claimPath(direct.id));
  assert.equal(own.estimatedReceivedHearts, 200);
  assert.deepEqual(own.segments[0].shares.map(({ userId }) => userId), [executor.id]);
  const privateOrder = await get(executor, orderPath(direct.id));
  assert.deepEqual(privateOrder.giftShares.map(({ userId }) => userId), [executor.id]);
  assert.equal(privateOrder.customerUserId, undefined);
  await get(fourth, orderPath(direct.id), 404);

  const customerOrder = await write('client', '/client/clubs/gifts/orders', 'POST', customer, {
    ...clientInput(16, 'customer recipient'), dispatcherUserId: dispatcher.id,
  }, 201);
  assert.equal(customerOrder.source, 'client_order');
  assert.equal((await db.collection('club_orders').findOne({ _id: new mongoose.Types.ObjectId(customerOrder.id) })).customerUserId, registered.id);
  await pay(customerOrder.id, [quote(5, 5), quote(11, 10)]);
  const compatibilityPublish = publishInput();
  const secondPublication = await post(dispatcher, orderPath(customerOrder.id) + '/publish', compatibilityPublish);
  assert.equal(secondPublication.dispatchStatus, 'published');
  await get(executor, claimPath(customerOrder.id), 404);
  const configuration = {
    requestId: randomUUID(), segments: [
      schedule(0, firstDay, false, [{ userId: dispatcher.id, dailyGiftTimes: 5, startDate: firstDay, endDate: firstDay }]),
      schedule(1, '2026-12-02'),
    ],
  };
  const configRoute = orderPath(customerOrder.id) + '/gift-dispatch';
  const beforeConfiguration = await get(dispatcher, configRoute);
  assert.equal(beforeConfiguration.totals.unconfiguredGiftTimes, 16);
  assert.deepEqual(beforeConfiguration.segmentTotals.map(segment => [segment.configured, segment.unconfiguredGiftTimes]), [[false, 5], [false, 11]]);
  await post(executor, configRoute, configuration, 404);
  await post(dispatcher, configRoute, { ...configuration, segments: [schedule(2, firstDay)] }, 400);
  await post(dispatcher, configRoute, {
    ...configuration, segments: [schedule(0, firstDay, false, [{ userId: dispatcher.id, dailyGiftTimes: 4, startDate: firstDay, endDate: firstDay }])],
  }, 400);
  const plan = await post(dispatcher, configRoute, configuration);
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments[1].publicSchedule.map(day => day.dailyGiftTimes), [10, 1]);
  assert.deepEqual(plan.totals, {
    paidGiftTimes: 16, claimedGiftTimes: 0, directedPendingGiftTimes: 5, publicRemainingGiftTimes: 11,
    unconfiguredGiftTimes: 0, unallocatedGiftTimes: 0,
  });
  assert.deepEqual((await post(dispatcher, configRoute, configuration)).segments, plan.segments);
  assert.equal((await post(dispatcher, orderPath(customerOrder.id) + '/publish', compatibilityPublish)).publishedAt, secondPublication.publishedAt);
  assert.deepEqual((await get(executor, claimPath(customerOrder.id))).segments.map(segment => segment.segmentIndex), [1]);
  const offerId = plan.segments[0].offers[0].id;
  const acceptance = { requestId: randomUUID(), segmentIndex: 0, kind: 'directed', offerId };
  await post(executor, claimPath(customerOrder.id), acceptance, 403);
  const first = await post(dispatcher, claimPath(customerOrder.id), acceptance);
  assert.equal(first.giftTimes, 5);
  assert.equal(first.requestedDailyGiftTimes, 5);

  const initialPublic = await claim(executor, customerOrder.id, 5, 201, { segmentIndex: 1, actualReceivedHearts: 12 });
  assert.deepEqual(initialPublic.schedule.map(day => day.dailyGiftTimes), [5, 1]);
  await claim(executor, customerOrder.id, 5, 409, { segmentIndex: 1 });
  const increase = await claim(executor, customerOrder.id, 7, 201, { segmentIndex: 1 });
  assert.equal(increase.requestedDailyGiftTimes, 7);
  assert.equal(increase.additionalRequestedDailyGiftTimes, 2);
  assert.equal(increase.giftTimes, 2);
  const byExecutor = (await get(dispatcher, configRoute)).segments[1].memberAllocations.find(item => item.userId === executor.id);
  assert.equal(byExecutor.giftTimes, 8);
  assert.deepEqual(byExecutor.schedule.map(item => item.dailyGiftTimes), [7, 1]);
  const memberView = await get(executor, claimPath(customerOrder.id));
  assert.equal(memberView.segments[0].memberAllocations, undefined);
  assert.equal(memberView.segments[0].myPublicRequestedDailyGiftTimes, 7);
  assert.equal(memberView.segments[0].publicRemainingGiftTimes, 3);
  assert.equal((await claim(third, customerOrder.id, 2, 201, { segmentIndex: 1 })).giftTimes, 2);

  const peer = await startPeer();
  const racers = [[executor, 8], [third, 3], [fourth, 4], [dispatcher, 6]].map(([auth, dailyGiftTimes]) => ({
    auth, body: { requestId: randomUUID(), segmentIndex: 1, kind: 'public', dailyGiftTimes },
  }));
  const rounds = await Promise.all(racers.map(({ auth, body }) => Promise.all([base, peer].map(async server => {
    const { data } = await request('employee', claimPath(customerOrder.id), { method: 'POST', auth, body, status: 201, server });
    return data;
  }))));
  for (const [first, replay] of rounds) assert.deepEqual(replay, first);
  assert.deepEqual(rounds.map(([result]) => result.giftTimes).sort(), [0, 0, 0, 1]);
  const winner = rounds.findIndex(([result]) => result.giftTimes === 1);
  const winningReceipt = rounds[winner][0];
  assert.equal(winningReceipt.dailyGiftTimes, 1);
  assert.match(winningReceipt.shareId, /^[a-f0-9]{24}$/);

  const orderId = new mongoose.Types.ObjectId(customerOrder.id);
  const orders = db.collection('club_orders');
  const claimedOrder = await orders.findOne({ _id: orderId });
  const storedRace = claimedOrder.giftDispatch.claims.filter(item => racers.some(racer => racer.body.requestId === item.requestId));
  assert.equal(storedRace.length, 4);
  const byDate = Object.fromEntries([firstDay, '2026-12-02'].map(date => [date,
    claimedOrder.giftDispatch.segments[1].shares.reduce((total, share) => total + share.days.reduce((sum, day) =>
      sum + (day.startDate <= date && date <= day.endDate ? day.dailyGiftTimes : 0), 0), 0),
  ]));
  assert.deepEqual(byDate, { [firstDay]: 10, '2026-12-02': 1 });
  assert.deepEqual(storedRace.find(item => item.requestId === racers[winner].body.requestId).result, winningReceipt);
  assert.equal((await get(dispatcher, configRoute)).totals.claimedGiftTimes, 16);
  const other = racers[(winner + 1) % racers.length].auth;
  await get(other, receiptPath(customerOrder.id, racers[winner].body.requestId), 404);

  const expectedOriginal = first.schedule;
  await orders.updateOne({ _id: orderId }, { $unset: {
    'giftDispatch.claims.$[claim].result.requestedDailyGiftTimes': '',
    'giftDispatch.claims.$[claim].result.schedule': '',
  } }, { arrayFilters: [{ 'claim.requestId': acceptance.requestId }] });

  // Persisted fulfillment facts use the existing report collection and share key.
  const originalId = new mongoose.Types.ObjectId();
  const where = { orderId: new mongoose.Types.ObjectId(customerOrder.id), shareId: new mongoose.Types.ObjectId(first.shareId),
    userId: dispatcher.id, businessDate: firstDay, accountId: new mongoose.Types.ObjectId() };
  const reports = db.collection('club_daily_reports');
  await reports.insertMany([
    { ...where, _id: originalId, originalId, requestId: randomUUID(), kind: 'daily', version: 1, lines: [{ quoteSegment: 1, giftTimes: 2, receivedHearts: 4 }] },
    { ...where, _id: new mongoose.Types.ObjectId(), originalId, requestId: randomUUID(), kind: 'correction', version: 2, lines: [{ quoteSegment: 1, giftTimes: 3, receivedHearts: 6 }] },
  ]);
  const transfer = { requestId: randomUUID(), shareId: first.shareId, userId: third.id };
  await post(executor, configRoute + '/reassign', transfer, 404);
  await post(dispatcher, configRoute + '/reassign', { ...transfer, userId: registered.id }, 400);
  const moved = await post(dispatcher, configRoute + '/reassign', transfer);
  assert.equal(moved.giftTimes, 2);
  assert.equal(moved.accepted, false);
  assert.equal(moved.transferredFromShareId, first.shareId);
  assert.deepEqual(await post(dispatcher, configRoute + '/reassign', transfer), moved);
  await post(dispatcher, configRoute + '/reassign', { ...transfer, requestId: randomUUID() }, 409);
  const afterTransfer = await get(dispatcher, configRoute);
  assert.deepEqual(afterTransfer.segmentTotals.map(segment => [segment.claimedGiftTimes, segment.directedPendingGiftTimes, segment.publicRemainingGiftTimes]),
    [[3, 2, 0], [11, 0, 0]]);
  assert.equal(afterTransfer.totals.claimedGiftTimes, 14);
  assert.equal(afterTransfer.totals.directedPendingGiftTimes, 2);
  assert.deepEqual(await get(dispatcher, receiptPath(customerOrder.id, acceptance.requestId)), first);
  const redirected = await get(third, claimPath(customerOrder.id));
  assert.equal(redirected.segments[0].shares.length, 0);
  await post(executor, claimPath(customerOrder.id), { ...acceptance, requestId: randomUUID(), offerId: moved.id }, 403);
  assert.equal((await post(third, claimPath(customerOrder.id), { ...acceptance, requestId: randomUUID(), offerId: moved.id })).giftTimes, 2);
  const afterAcceptance = await get(dispatcher, configRoute);
  const prior = afterAcceptance.segments[0].shares.find(share => share.id === first.shareId);
  assert.equal(prior.giftTimes, 5);
  assert.equal(prior.netGiftTimes, 3);
  assert.equal(prior.transferredGiftTimes, 2);
  assert.equal(prior.deliveredGiftTimes, 3);
  assert.deepEqual(prior.originalSchedule, expectedOriginal);
  assert.equal(afterAcceptance.segmentTotals[0].claimedGiftTimes, 5);
  assert.equal(afterAcceptance.totals.claimedGiftTimes, 16);
  assert.equal(afterAcceptance.totals.directedPendingGiftTimes, 0);
  assert.equal(await reports.countDocuments(where), 2);

  await orders.updateOne({ _id: orderId }, { $set: { dispatchWithdrawnAt: new Date() } });
  await get(racers[winner].auth, claimPath(customerOrder.id), 404);
  assert.deepEqual(await post(racers[winner].auth, claimPath(customerOrder.id), racers[winner].body), winningReceipt);
  assert.deepEqual(await get(racers[winner].auth, receiptPath(customerOrder.id, racers[winner].body.requestId)), winningReceipt);
  assert.deepEqual(await post(dispatcher, claimPath(customerOrder.id), acceptance), first);
  await post(other, claimPath(customerOrder.id), racers[winner].body, 404);
  await post(racers[winner].auth, claimPath(customerOrder.id), { ...racers[winner].body, requestId: randomUUID() }, 404);
  const stopped = await get(dispatcher, configRoute);
  assert.equal(stopped.acceptingClaims, false);
  assert.equal(stopped.totals.claimedGiftTimes, 16);
  await db.collection('club_members').updateOne({ clubId: 'gifts', userId: racers[winner].auth.id }, { $set: { active: false } });
  await get(racers[winner].auth, receiptPath(customerOrder.id, racers[winner].body.requestId), 403);
});
