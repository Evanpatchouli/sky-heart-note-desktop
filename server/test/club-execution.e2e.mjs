import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const origin = app => `https://${app}.execution.test`;
const club = '/employee/clubs/execution';
const accountRoute = '/employee/songxinhao';
const startDate = '2026-12-01';
const endDate = '2026-12-10';
const occurrence = '2026-01-02T04:00:00.000Z';

test('按次承接关联本人 SQLite 送心号并核对实际解锁', { timeout: 120000 }, async t => {
  const { db, base, password, runCommand, startPeer } = await startSystem(t, {
    database: 'club_execution_e2e', adminUsername: 'execution_admin',
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, origin(app)])),
  });
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);
  async function request(app, path, { actor, method = 'GET', body, status = 200, cookie, server = base } = {}) {
    const headers = { origin: origin(app) };
    if (actor) headers.authorization = `Bearer ${actor.token}`;
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(server + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { data: payload.data, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  }
  const call = async (actor, path, method = 'GET', body, status = method === 'POST' ? 201 : 200, app = 'employee', server) =>
    (await request(app, path, { actor, method, body, status, server })).data;
  async function login(app, username) {
    const { cookie } = await request(app, `/captcha/login?app=${app}`);
    return (await request(app, '/user/login?type=account', {
      method: 'POST', status: 201, cookie, body: { app, username, password, captcha: captchaCode },
    })).data;
  }
  const dispatcher = await login('employee', 'execution_admin');
  const administrator = await login('admin', 'execution_admin');
  await configure('club', 'execution', '送心俱乐部');
  await configure('club', 'outside', '另一家俱乐部');
  await configure('member', 'execution', dispatcher.id, 'active', 'dispatcher');
  await configure('grant', 'execution', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await call(administrator, '/admin/clubs/execution/commission-rule', 'PATCH', {
    expectedVersion: 0, basis: 'gift_times', clubFeeCents: 5,
  }, 200, 'admin');

  async function invite(username) {
    const { invitationUrl } = await call(dispatcher, club + '/member-invitations', 'POST');
    const token = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('token');
    await call(null, '/client/club-invitations/register', 'POST', { token, username, password }, 201, 'client');
    return login('employee', username);
  }
  async function register(username) {
    const { cookie } = await request('client', '/captcha/register?app=client');
    await request('client', '/user/register?type=account', {
      method: 'POST', status: 201, cookie, body: { app: 'client', username, password, captcha: captchaCode },
    });
    return login('client', username);
  }
  const first = await invite('execution_first');
  const second = await invite('execution_second');
  const customer = await register('execution_customer');
  const otherCustomer = await register('execution_other_customer');
  await configure('member', 'outside', first.id, 'active', 'member');
  await db.collection('users').updateMany({ _id: { $in: [first.id, second.id] } }, { $set: { nickname: '同名团员' } });
  await db.collection('users').updateOne({ _id: customer.id }, { $set: { nickname: '平台老板' } });
  const peer = await startPeer();

  const listPersonal = actor => call(actor, accountRoute + '/linkable');
  const add = (actor, name) => call(actor, accountRoute, 'POST', { name });
  const detail = (actor, order) => call(actor, club + '/gift-claims/' + order.id);
  const stored = order => db.collection('club_orders').findOne({ _id: new mongoose.Types.ObjectId(order.id) });
  const accountsPath = (order, share) => `${order.route}/shares/${share.shareId}/execution-accounts`;
  const link = (order, share, actor, personalAccountId, status = 201, server) =>
    call(actor, accountsPath(order, share), 'POST', { personalAccountId }, status, 'employee', server);
  const record = (order, share, actor, account, relationship = 'new_unlock', status = 201, occurredAt, server) =>
    call(actor, `${accountsPath(order, share)}/${account.id}/relationship`, 'POST', {
      relationship, ...(occurredAt === undefined ? {} : { occurredAt }),
    }, status, 'employee', server);
  const readReview = async order => (await call(dispatcher, order.route + '/gift-dispatch')).unlockReview;
  const directedDays = { userId: first.id, dailyGiftTimes: 5, startDate, endDate };
  async function publish({ unlock, legacyUnlock = false, directed = [], fromClient = false, split = false } = {}) {
    const input = { requestId: randomUUID(), recipientGameAccount: '接收账号 · 云海', requestedGiftTimes: 100 };
    const order = fromClient
      ? await call(customer, '/client/clubs/execution/orders', 'POST', { ...input, dispatcherUserId: dispatcher.id }, 201, 'client')
      : await call(dispatcher, club + '/orders', 'POST', { ...input, existingCustomerUserId: customer.id });
    const route = club + '/orders/' + order.id;
    const quote = (paidGiftTimes, dailyGiftTimes, period = 'normal') => ({ period, paidGiftTimes, dailyGiftTimes, unitPriceCents: 50 });
    const giftSegments = split ? [quote(60, 6), quote(40, 4, 'double')] : [quote(100, 10)];
    if (legacyUnlock) {
      await db.collection('club_orders').updateOne({ _id: new mongoose.Types.ObjectId(order.id) }, { $set: { pricing: {
        ruleVersion: 1, revision: 1, basis: 'gift_times', dispatchFeeCents: 5, segments: [], priceUnit: 'gift_times',
        giftSegments, ...(unlock ? { unlock } : {}),
      } } });
    }
    const { quote: saved } = legacyUnlock ? await call(dispatcher, route + '/pricing') :
      await call(dispatcher, route + '/pricing', 'PATCH', {
        expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5, giftSegments, ...(unlock ? { unlock } : {}),
      });
    await call(dispatcher, route + '/receipts', 'POST', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: saved.totalAmountCents,
      receivedAt: '2026-11-24T19:40:00+08:00',
    });
    await call(dispatcher, route + '/publish', 'POST', {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: giftSegments.map((_, segmentIndex) =>
        ({ segmentIndex, startDate, endDate, openToClaim: true, directed: segmentIndex === 0 ? directed : [] })),
    });
    return { ...order, route };
  }
  function claim(order, actor, segmentIndex, dailyGiftTimes, offerId, server) {
    return call(actor, club + '/gift-claims/' + order.id, 'POST', {
      requestId: randomUUID(), segmentIndex, ...(offerId ? { kind: 'directed', offerId } : { kind: 'public', dailyGiftTimes }),
    }, 201, 'employee', server);
  }
  const executorShares = order => order.segments.flatMap(segment => segment.shares);
  const summary = (actualCount, actualAmountCents, agreedUnitPriceCents, unpricedCount = 0) =>
    ({ actualCount, actualAmountCents, unpricedCount, agreedUnitPriceCents });

  await t.test('各领 50 次，各 5 次新解锁分别 0.50 元，全单 1.00 元', async () => {
    await Promise.all([first, second].map(async actor => {
      for (const name of ['同名', '同名', '账号三', '账号四', '账号五', '已有好友用号']) await add(actor, name);
    }));
    const [firstAccounts, secondAccounts] = await Promise.all([listPersonal(first), listPersonal(second)]);
    assert.equal(firstAccounts[0].localId, secondAccounts[0].localId);
    assert.equal(firstAccounts[0].name, secondAccounts[0].name);
    assert.equal(firstAccounts[0].name, firstAccounts[1].name);
    assert.equal(new Set([...firstAccounts, ...secondAccounts].map(account => account.id)).size, 12);
    const order = await publish({ unlock: { quantity: 10, unitPriceCents: 10 }, directed: [directedDays] });
    const original = await stored(order);
    const offerId = (await detail(first, order)).segments[0].offers[0].id;
    const firstShare = await claim(order, first, 0, undefined, offerId);
    const [secondShare, bound, repeated] = await Promise.all([
      claim(order, second, 0, 5, undefined, peer),
      link(order, firstShare, first, firstAccounts[0].id),
      link(order, firstShare, first, firstAccounts[0].id, 201, peer),
    ]);
    assert.deepEqual([firstShare.giftTimes, secondShare.giftTimes], [50, 50]);
    assert.deepEqual(bound, repeated);
    assert.equal(bound.customerUserId, undefined);
    assert.equal(bound.customerNickname, undefined);
    assert.equal(bound.relationship, null);
    assert.equal((await readReview(order)).actualAmountCents, 0);

    await link(order, firstShare, second, secondAccounts[0].id, 404);
    await link(order, firstShare, first, secondAccounts[0].id, 404);
    await link(order, firstShare, dispatcher, firstAccounts[0].id, 404);
    await link({ ...order, route: order.route.replace('/execution/', '/outside/') }, firstShare, first, firstAccounts[0].id, 404);
    await call(second, order.route + '/gift-dispatch', 'GET', undefined, 404);
    await call(customer, accountsPath(order, firstShare), 'POST', { personalAccountId: firstAccounts[0].id }, 403, 'client');
    await call(first, accountsPath(order, firstShare), 'POST', { personalAccountId: firstAccounts[0].id, name: '替换名称' }, 400);
    await configure('member', 'execution', first.id, 'inactive', 'member');
    await link(order, firstShare, first, firstAccounts[0].id, 403);
    await record(order, firstShare, first, bound, 'new_unlock', 403);
    await configure('member', 'execution', first.id, 'active', 'member');

    await record(order, secondShare, second, bound, 'new_unlock', 404);
    const [entry, duplicate] = await Promise.all([
      record(order, firstShare, first, bound, 'new_unlock', 201, occurrence),
      record(order, firstShare, first, bound, 'new_unlock', 201, occurrence, peer),
    ]);
    assert.deepEqual(entry, duplicate);
    assert.equal(entry.relationship.amountCents, 10);
    assert.equal(entry.relationship.occurredAt, occurrence);
    assert.ok(Date.parse(entry.relationship.recordedAt) >= Date.parse(occurrence));
    await record(order, firstShare, first, bound, 'existing_friend', 409);
    await record(order, firstShare, first, bound, 'new_unlock', 409, '2026-01-03T04:00:00.000Z');
    assert.equal((await readReview(order)).differenceCents, -90);
    await Promise.all([
      ...firstAccounts.slice(1, 5).map(async account => record(order, firstShare, first, await link(order, firstShare, first, account.id))),
      ...secondAccounts.slice(0, 5).map(async account => record(order, secondShare, second, await link(order, secondShare, second, account.id))),
    ]);

    const friend = await link(order, firstShare, first, firstAccounts[5].id);
    const existing = await record(order, firstShare, first, friend, 'existing_friend');
    assert.deepEqual(await record(order, firstShare, first, friend, 'existing_friend'), existing);
    assert.equal(existing.relationship.amountCents, 0);
    for (const [actor, ownCount] of [[first, 6], [second, 5]]) {
      const own = await detail(actor, order);
      assert.equal(own.recipientGameAccount, '接收账号 · 云海');
      assert.deepEqual(own.fulfillment, summary(5, 50, 10));
      const shares = executorShares(own);
      assert.ok(shares.every(({ userId }) => userId === actor.id));
      const accounts = shares.flatMap(share => share.executionGameAccounts);
      assert.equal(accounts.length, ownCount);
      assert.ok(accounts.every(row => !('customerUserId' in row) && !('customerNickname' in row)));
    }
    const review = await readReview(order);
    assert.equal(review.actualCount, 10);
    assert.equal(review.estimatedAmountCents, 100);
    assert.equal(review.actualAmountCents, 100);
    assert.equal(review.receivedAmountCents, 5100);
    assert.equal(review.differenceCents, 0);
    assert.deepEqual(review.members.map(({ userId, actualCount, actualAmountCents, nickname }) =>
      [userId, actualCount, actualAmountCents, nickname]).sort(), [[first.id, 5, 50, '同名团员'], [second.id, 5, 50, '同名团员']].sort());
    assert.equal(review.records.length, 11);
    assert.equal(review.records.filter(({ name }) => name === '同名').length, 4);
    assert.ok(review.records.every(({ id, personalAccountId, customerUserId, customerNickname, relationship }) =>
      Boolean(id && personalAccountId && customerUserId === customer.id && customerNickname === '平台老板' && relationship.recordedAt)));

    await call(first, accountRoute + '/' + firstAccounts[0].localId, 'PATCH', { name: '改过名字' });
    const renamed = (await listPersonal(first)).find(account => account.localId === firstAccounts[0].localId);
    assert.equal(renamed.id, firstAccounts[0].id);
    assert.equal(renamed.name, '改过名字');
    assert.deepEqual(await link(order, firstShare, first, renamed.id), entry);
    await call(first, accountRoute + '/' + firstAccounts[5].localId, 'DELETE');
    const recreatedLocalId = await add(first, firstAccounts[5].name);
    assert.equal(String(recreatedLocalId), firstAccounts[5].localId);
    const recreated = (await listPersonal(first)).find(account => account.localId === String(recreatedLocalId));
    assert.notEqual(recreated.id, firstAccounts[5].id);
    assert.deepEqual(await link(order, firstShare, first, firstAccounts[5].id), existing);
    const replacement = await link(order, firstShare, first, recreated.id);
    assert.notEqual(replacement.id, existing.id);
    assert.equal(replacement.relationship, null);
    assert.equal((await readReview(order)).actualAmountCents, 100);

    const current = await stored(order);
    assert.deepEqual(current.receipt, original.receipt);
    assert.deepEqual(current.dispatchPricing, original.dispatchPricing);
    assert.equal(current.giftDispatch.executionAccounts.filter(row => row.relationship?.kind === 'new_unlock').length, 10);
    const clientOrder = await call(customer, '/client/clubs/execution/orders/' + order.id, 'GET', undefined, 200, 'client');
    assert.equal(clientOrder.quote.unlockAmountCents, 100);
    assert.equal(clientOrder.receipt.receivedAmountCents, 5100);
    for (const key of ['fulfillment', 'unlockReview', 'giftDispatch', 'executionAccounts', 'giftShares'])
      assert.equal(clientOrder[key], undefined);
    await call(otherCustomer, '/client/clubs/execution/orders/' + order.id, 'GET', undefined, 404, 'client');
  });

  await t.test('跨段、追加和改派中的同一送心号复用关系并保留归属', async () => {
    const [personal] = await listPersonal(first);
    const order = await publish({ unlock: { quantity: 1, unitPriceCents: 10 }, split: true });
    const initial = await claim(order, first, 0, 1);
    const [added, bound] = await Promise.all([
      claim(order, first, 0, 2, undefined, peer),
      link(order, initial, first, personal.id),
    ]);
    const crossSegment = await claim(order, first, 1, 1);
    for (const share of [added, crossSegment])
      assert.equal((await link(order, share, first, personal.id)).id, bound.id);
    const [a, b] = await Promise.all([
      record(order, added, first, bound, 'new_unlock', 201, occurrence),
      record(order, crossSegment, first, bound, 'new_unlock', 201, occurrence, peer),
    ]);
    assert.deepEqual(a, b);
    assert.equal((await readReview(order)).actualCount, 1);
    assert.equal((await readReview(order)).actualAmountCents, 10);
    const another = (await listPersonal(first))[1];
    const [transfer, concurrentAccount] = await Promise.all([
      call(dispatcher, order.route + '/gift-dispatch/reassign', 'POST', {
        requestId: randomUUID(), shareId: initial.shareId, userId: second.id,
      }),
      link(order, added, first, another.id, 201, peer),
    ]);
    const accepted = await claim(order, second, 0, undefined, transfer.id);
    await link(order, accepted, second, personal.id, 404);
    await record(order, accepted, second, bound, 'new_unlock', 404);
    const next = await detail(first, order);
    assert.deepEqual(next.fulfillment, summary(1, 10, 10));
    assert.equal(executorShares(next).find(share => share.id === initial.shareId).executionGameAccounts[0].userId, first.id);
    assert.equal(executorShares(next).find(share => share.id === added.shareId).executionGameAccounts.length, 2);
    assert.equal(concurrentAccount.relationship, null);
    await link(order, initial, first, another.id, 409);
    assert.deepEqual(await record(order, initial, first, bound, 'new_unlock', 201, occurrence), a);
    await db.collection('club_orders').updateOne({ _id: new mongoose.Types.ObjectId(order.id) }, {
      $set: { dispatchWithdrawnAt: new Date() },
    });
    const history = await detail(first, order);
    assert.equal(history.acceptingClaims, false);
    assert.deepEqual(history.fulfillment, summary(1, 10, 10));
    await call(second, club + '/gift-claims/' + order.id, 'GET', undefined, 404);
    await record(order, added, first, concurrentAccount, 'existing_friend', 409);
    assert.deepEqual(await record(order, initial, first, bound, 'new_unlock', 201, occurrence), a);
  });

  await t.test('派单人自派自接时可在本人份额登记已有好友', async () => {
    await add(dispatcher, '派单人自用号');
    const [personal] = await listPersonal(dispatcher);
    const order = await publish({ unlock: { quantity: 1, unitPriceCents: 10 } });
    const own = await claim(order, dispatcher, 0, 2);
    const linked = await link(order, own, dispatcher, personal.id);
    const saved = await record(order, own, dispatcher, linked, 'existing_friend');
    assert.equal(saved.relationship.amountCents, 0);
    assert.deepEqual((await detail(dispatcher, order)).fulfillment, summary(0, 0, 10));
    assert.equal((await readReview(order)).records[0].userId, dispatcher.id);
  });

  await t.test('已约定免费和未知价格分别保存为零和未知', async () => {
    const [personal] = await listPersonal(first);
    for (const [unlock, price] of [
      [undefined, null],
      [{ quantity: 0, unitPriceCents: 0 }, null],
      [{ quantity: 2, unitPriceCents: 0, unitPriceAgreed: false }, null],
      [{ quantity: 0, unitPriceCents: 0, unitPriceAgreed: true }, 0],
      [{ quantity: 1, unitPriceCents: 0 }, 0],
    ]) {
      const order = await publish({ unlock, legacyUnlock: true, fromClient: true });
      const share = await claim(order, first, 0, 10);
      const linked = await link(order, share, first, personal.id);
      await record(order, share, first, linked, 'new_unlock', 400, 'not-a-date');
      const saved = await record(order, share, first, linked);
      assert.equal(saved.relationship.amountCents, price);
      assert.deepEqual((await detail(first, order)).fulfillment, summary(1, 0, price, price === null ? 1 : 0));
      assert.equal((await readReview(order)).differenceCents, price === null ? null : 0);
    }
  });

  await t.test('历史按颗订单读取原送心账号标识并保持原始快照', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const shareId = new mongoose.Types.ObjectId();
    const historical = { _id: new mongoose.Types.ObjectId(), name: '旧版执行号' };
    await db.collection('club_orders').insertOne({
      _id: orderId, clubId: 'execution', source: 'direct_dispatch', businessType: 'heart_delivery',
      createdAt: new Date(), createdByUserId: dispatcher.id, dispatcherUserId: dispatcher.id, requestId: randomUUID(),
      customerLinkStatus: 'verified', customerUserId: customer.id, recipientGameAccount: '旧接收号',
      dispatchStatus: 'published', heartDelivery: { requestedHearts: 10 },
      shares: [{ _id: shareId, userId: first.id, hearts: 10, executionGameAccounts: [historical] }],
    });
    const route = club + '/orders/' + orderId.toHexString();
    const detail = await call(first, route);
    assert.equal(detail.requestedHearts, 10);
    assert.deepEqual(detail.shares[0].executionGameAccounts, [{ id: historical._id.toHexString(), name: historical.name }]);
    await record({ route }, { shareId: shareId.toHexString() }, first, { id: historical._id.toHexString() }, 'new_unlock', 404);
  });
});
