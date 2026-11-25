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
  const { db, base, password, runCommand } = await startSystem(t, {
    database: 'club_gift_dispatch_e2e', adminUsername: 'gift_admin',
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, origin(app)])),
  });
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);

  async function request(app, path, { method = 'GET', auth, body, status = 200, cookie } = {}) {
    const headers = { origin: origin(app) };
    if (auth) headers.authorization = `Bearer ${auth.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: JSON.stringify(body) });
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
  const claimed = [
    await claim(dispatcher, direct.id, 5, 201, five), await claim(executor, direct.id, 3),
    await claim(third, direct.id, 5), await claim(fourth, direct.id, 5),
  ];
  assert.deepEqual(claimed.map(({ dailyGiftTimes, giftTimes }) => [dailyGiftTimes, giftTimes]), [[5, 50], [3, 30], [2, 20], [0, 0]]);
  assert.equal(claimed[0].actualReceivedHearts, 0);
  assert.equal(claimed[1].actualReceivedHearts, undefined);
  assert.deepEqual(await claim(dispatcher, direct.id, 5, 201, five), claimed[0]);
  await claim(dispatcher, direct.id, 4, 409, five);
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
  await post(executor, configRoute, configuration, 404);
  await post(dispatcher, configRoute, { ...configuration, segments: [schedule(2, firstDay)] }, 400);
  await post(dispatcher, configRoute, {
    ...configuration, segments: [schedule(0, firstDay, false, [{ userId: dispatcher.id, dailyGiftTimes: 4, startDate: firstDay, endDate: firstDay }])],
  }, 400);
  const plan = await post(dispatcher, configRoute, configuration);
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments[1].publicSchedule.map(day => day.dailyGiftTimes), [10, 1]);
  assert.deepEqual((await post(dispatcher, configRoute, configuration)).segments, plan.segments);
  assert.equal((await post(dispatcher, orderPath(customerOrder.id) + '/publish', compatibilityPublish)).publishedAt, secondPublication.publishedAt);
  assert.deepEqual((await get(executor, claimPath(customerOrder.id))).segments.map(segment => segment.segmentIndex), [1]);
  const offerId = plan.segments[0].offers[0].id;
  const acceptance = { requestId: randomUUID(), segmentIndex: 0, kind: 'directed', offerId };
  await post(executor, claimPath(customerOrder.id), acceptance, 403);
  const first = await post(dispatcher, claimPath(customerOrder.id), acceptance);
  assert.equal(first.giftTimes, 5);

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
  const redirected = await get(third, claimPath(customerOrder.id));
  assert.equal(redirected.segments[0].shares.length, 0);
  await post(executor, claimPath(customerOrder.id), { ...acceptance, requestId: randomUUID(), offerId: moved.id }, 403);
  assert.equal((await post(third, claimPath(customerOrder.id), { ...acceptance, requestId: randomUUID(), offerId: moved.id })).giftTimes, 2);
  const prior = (await get(dispatcher, configRoute)).segments[0].shares.find(share => share.id === first.shareId);
  assert.equal(prior.giftTimes, 5);
  assert.equal(prior.transferredGiftTimes, 2);
  assert.equal(prior.deliveredGiftTimes, 3);
  assert.equal(await reports.countDocuments(where), 2);
});
