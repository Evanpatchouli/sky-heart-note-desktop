import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const origin = app => `https://${app}.execution.test`;
const club = '/employee/club';
const accountRoute = '/employee/songxinhao';
const startDate = '2026-12-01';
const endDate = '2026-12-10';

test('按次承接关联本人 SQLite 送心号并独立填报实绩', { timeout: 120000 }, async t => {
  const { db, base, password, seedClub, startPeer } = await startSystem(t, {
    database: 'club_execution_e2e', adminUsername: 'execution_admin',
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, origin(app)])),
  });
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
  await seedClub('name', '送心俱乐部');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await call(administrator, '/admin/club/commission-rule', 'PATCH', {
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
  const report = (order, share, actor, account) =>
    call(actor, `${accountsPath(order, share)}/${account.id}/daily-reports`, 'POST', {
      requestId: randomUUID(), kind: 'daily', businessDate: startDate, lines: [{ giftTimes: 5, receivedHearts: 5 }],
    });
  const directedDays = { userId: first.id, dailyGiftTimes: 5, startDate, endDate };
  async function publish({ directed = [], fromClient = false, split = false } = {}) {
    const input = { requestId: randomUUID(), recipientGameAccount: '接收账号 · 云海', requestedGiftTimes: 100 };
    const order = fromClient
      ? await call(customer, '/client/orders', 'POST', { ...input, dispatcherUserId: dispatcher.id }, 201, 'client')
      : await call(dispatcher, club + '/orders', 'POST', { ...input, existingCustomerUserId: customer.id });
    const route = club + '/orders/' + order.id;
    const quote = (paidGiftTimes, dailyGiftTimes, period = 'normal') => ({ period, paidGiftTimes, dailyGiftTimes, unitPriceCents: 50 });
    const giftSegments = split ? [quote(60, 6), quote(40, 4, 'double')] : [quote(100, 10)];
    const { quote: saved } = await call(dispatcher, route + '/pricing', 'PATCH', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5, giftSegments,
    });
    assert.equal(saved.totalAmountCents, 5000);
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

  await t.test('P1-01 两笔按次订单互换派接职责并可自派自接', async () => {
    const memberA = await invite('role_matrix_a');
    const memberB = await invite('role_matrix_b');
    const personalByUser = new Map();
    for (const actor of [memberA, memberB]) {
      await seedClub('member', actor.id, 'active', 'dispatcher');
      await add(actor, '互换职责验收号');
      const [personal] = await listPersonal(actor);
      personalByUser.set(actor.id, personal.id);
    }
    const clientOrders = '/client/orders';
    const input = recipientGameAccount => ({ requestId: randomUUID(), recipientGameAccount, requestedGiftTimes: 100 });
    const direct = await call(memberA, club + '/orders', 'POST', { ...input('甲派乙接'), existingCustomerUserId: customer.id });
    const online = await call(otherCustomer, clientOrders, 'POST', {
      ...input('乙派甲接'), dispatcherUserId: memberB.id,
    }, 201, 'client');
    assert.deepEqual([direct.source, online.source], ['direct_dispatch', 'client_order']);

    for (const [created, sender, worker, owner, otherOwner] of [
      [direct, memberA, memberB, customer, otherCustomer], [online, memberB, memberA, otherCustomer, customer],
    ]) {
      const order = { ...created, route: club + '/orders/' + created.id };
      const pricing = {
        expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
        giftSegments: [{ period: 'normal', paidGiftTimes: 100, dailyGiftTimes: 10, unitPriceCents: 50 }],
      };
      await call(worker, order.route + '/pricing', 'PATCH', pricing, 404);
      const { quote } = await call(sender, order.route + '/pricing', 'PATCH', pricing);
      assert.equal(quote.totalAmountCents, 5000);
      const receipt = {
        requestId: randomUUID(), pricingRevision: quote.revision, receivedAmountCents: 5000, receivedAt: '2026-11-24T19:40:00+08:00',
      };
      await call(worker, order.route + '/receipts', 'POST', receipt, 404);
      await call(sender, order.route + '/receipts', 'POST', receipt);
      const published = await call(sender, order.route + '/publish', 'POST', {
        requestId: randomUUID(), pricingRevision: quote.revision, ruleVersion: 1, commissionReviewRevision: 0,
        giftDispatchSegments: [{ segmentIndex: 0, startDate, endDate, openToClaim: true, directed: [] }],
      });
      assert.equal(published.dispatchStatus, 'published');

      const workerShare = await claim(order, worker, 0, 5);
      const selfShare = await claim(order, sender, 0, 5);
      assert.deepEqual([workerShare.giftTimes, selfShare.giftTimes], [50, 50]);
      await link(order, workerShare, worker, personalByUser.get(sender.id), 404);
      await link(order, workerShare, sender, personalByUser.get(sender.id), 404);
      const workerAccount = await link(order, workerShare, worker, personalByUser.get(worker.id));
      const selfAccount = await link(order, selfShare, sender, personalByUser.get(sender.id));
      const workerReport = await report(order, workerShare, worker, workerAccount);
      const selfReport = await report(order, selfShare, sender, selfAccount);
      await call(sender, `${order.route}/daily-reports/${workerReport.originalId}/corrections`, 'POST', {
        requestId: randomUUID(), expectedVersion: 1, reason: '检查本人日报权限', lines: [{ giftTimes: 5, receivedHearts: 5 }],
      }, 404);

      const ownShares = executorShares(await detail(worker, order));
      assert.deepEqual(ownShares.map(share => share.id), [workerShare.shareId]);
      assert.deepEqual(ownShares[0].executionGameAccounts.map(account => account.id), [workerAccount.id]);
      for (const [actor, ownReport] of [[worker, workerReport], [sender, selfReport]]) {
        const { items } = await call(actor, order.route + '/daily-reports');
        assert.deepEqual(items.map(item => item.id), [ownReport.id]);
      }
      await call(worker, order.route + '/fulfillment', 'GET', undefined, 404);
      const overview = await call(sender, order.route + '/fulfillment');
      assert.deepEqual(overview.segments[0].members.map(member => member.userId).sort(), [sender.id, worker.id].sort());

      const customerOrder = await call(owner, `${clientOrders}/${order.id}`, 'GET', undefined, 200, 'client');
      assert.equal(customerOrder.receipt.receivedAmountCents, 5000);
      assert.equal(customerOrder.deliveryProgress.deliveredGiftTimes, 10);
      for (const key of ['promotionBasis', 'pendingCompensation', 'dispatchFeeCents', 'clubFeeCents', 'memberFeeCents', 'executionGameAccounts'])
        assert.ok(!JSON.stringify(customerOrder).includes(`"${key}"`), `客户视图泄漏 ${key}`);
      await call(otherOwner, `${clientOrders}/${order.id}`, 'GET', undefined, 404, 'client');
    }
  });

  await t.test('各领 50 次，可关联多个本人送心号并直接写日报', async () => {
    await Promise.all([first, second].map(async actor => {
      for (const name of ['同名', '同名', '账号三', '账号四', '账号五', '第六个号']) await add(actor, name);
    }));
    const [firstAccounts, secondAccounts] = await Promise.all([listPersonal(first), listPersonal(second)]);
    assert.equal(firstAccounts[0].localId, secondAccounts[0].localId);
    assert.equal(firstAccounts[0].name, secondAccounts[0].name);
    assert.equal(firstAccounts[0].name, firstAccounts[1].name);
    assert.equal(new Set([...firstAccounts, ...secondAccounts].map(account => account.id)).size, 12);
    const order = await publish({ directed: [directedDays] });
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

    await link(order, firstShare, second, secondAccounts[0].id, 404);
    await link(order, firstShare, first, secondAccounts[0].id, 404);
    await link(order, firstShare, dispatcher, firstAccounts[0].id, 404);
    await link({ ...order, route: order.route.replace('/employee/club/', '/employee/clubs/outside/') }, firstShare, first, firstAccounts[0].id, 404);
    await call(second, order.route + '/gift-dispatch', 'GET', undefined, 404);
    await call(customer, accountsPath(order, firstShare), 'POST', { personalAccountId: firstAccounts[0].id }, 403, 'client');
    await call(first, accountsPath(order, firstShare), 'POST', { personalAccountId: firstAccounts[0].id, name: '替换名称' }, 400);
    await seedClub('member', first.id, 'inactive', 'member');
    await link(order, firstShare, first, firstAccounts[0].id, 403);
    await seedClub('member', first.id, 'active', 'member');

    await call(first, `${accountsPath(order, firstShare)}/${bound.id}/relationship`, 'POST', {
      relationship: 'new_unlock',
    }, 404);
    assert.equal((await report(order, firstShare, first, bound)).giftTimes, 5);
    const secondBound = await link(order, secondShare, second, secondAccounts[0].id);
    assert.equal((await report(order, secondShare, second, secondBound)).giftTimes, 5);
    await Promise.all([
      ...firstAccounts.slice(1, 5).map(account => link(order, firstShare, first, account.id)),
      ...secondAccounts.slice(1, 5).map(account => link(order, secondShare, second, account.id)),
    ]);
    const sixth = await link(order, firstShare, first, firstAccounts[5].id);
    for (const [actor, ownCount] of [[first, 6], [second, 5]]) {
      const own = await detail(actor, order);
      assert.equal(own.recipientGameAccount, '接收账号 · 云海');
      const shares = executorShares(own);
      assert.ok(shares.every(({ userId }) => userId === actor.id));
      const accounts = shares.flatMap(share => share.executionGameAccounts);
      assert.equal(accounts.length, ownCount);
      assert.ok(accounts.every(row => !('customerUserId' in row) && !('customerNickname' in row)));
    }

    await call(first, accountRoute + '/' + firstAccounts[0].localId, 'PATCH', { name: '改过名字' });
    const renamed = (await listPersonal(first)).find(account => account.localId === firstAccounts[0].localId);
    assert.equal(renamed.id, firstAccounts[0].id);
    assert.equal(renamed.name, '改过名字');
    assert.deepEqual(await link(order, firstShare, first, renamed.id), bound);
    await call(first, accountRoute + '/' + firstAccounts[5].localId, 'DELETE');
    const recreatedLocalId = await add(first, firstAccounts[5].name);
    assert.equal(String(recreatedLocalId), firstAccounts[5].localId);
    const recreated = (await listPersonal(first)).find(account => account.localId === String(recreatedLocalId));
    assert.notEqual(recreated.id, firstAccounts[5].id);
    assert.deepEqual(await link(order, firstShare, first, firstAccounts[5].id), sixth);
    const replacement = await link(order, firstShare, first, recreated.id);
    assert.notEqual(replacement.id, sixth.id);

    const current = await stored(order);
    assert.deepEqual(current.receipt, original.receipt);
    assert.deepEqual(current.dispatchPricing, original.dispatchPricing);
    assert.equal(current.giftDispatch.executionAccounts.length, 12);
    const clientOrder = await call(customer, '/client/orders/' + order.id, 'GET', undefined, 200, 'client');
    assert.equal(clientOrder.receipt.receivedAmountCents, 5000);
    assert.equal(clientOrder.deliveryProgress.deliveredGiftTimes, 10);
    for (const key of ['fulfillment', 'unlockReview', 'giftDispatch', 'executionAccounts', 'giftShares'])
      assert.equal(clientOrder[key], undefined);
    await call(otherCustomer, '/client/orders/' + order.id, 'GET', undefined, 404, 'client');
  });

  await t.test('跨段、追加和改派中的同一送心号复用关联并保留归属', async () => {
    const [personal] = await listPersonal(first);
    const order = await publish({ split: true });
    const initial = await claim(order, first, 0, 1);
    const [added, bound] = await Promise.all([
      claim(order, first, 0, 2, undefined, peer),
      link(order, initial, first, personal.id),
    ]);
    const crossSegment = await claim(order, first, 1, 1);
    for (const share of [added, crossSegment])
      assert.equal((await link(order, share, first, personal.id)).id, bound.id);
    const another = (await listPersonal(first))[1];
    const [transfer] = await Promise.all([
      call(dispatcher, order.route + '/gift-dispatch/reassign', 'POST', {
        requestId: randomUUID(), shareId: initial.shareId, userId: second.id,
      }),
      link(order, added, first, another.id, 201, peer),
    ]);
    const accepted = await claim(order, second, 0, undefined, transfer.id);
    await link(order, accepted, second, personal.id, 404);
    const next = await detail(first, order);
    assert.equal(executorShares(next).find(share => share.id === initial.shareId).executionGameAccounts[0].userId, first.id);
    assert.equal(executorShares(next).find(share => share.id === added.shareId).executionGameAccounts.length, 2);
    await link(order, initial, first, another.id, 409);
    assert.equal((await link(order, initial, first, personal.id)).id, bound.id);
    await db.collection('club_orders').updateOne({ _id: new mongoose.Types.ObjectId(order.id) }, {
      $set: { dispatchWithdrawnAt: new Date() },
    });
    const history = await detail(first, order);
    assert.equal(history.acceptingClaims, false);
    await call(second, club + '/gift-claims/' + order.id, 'GET', undefined, 404);
    assert.equal((await link(order, initial, first, personal.id)).id, bound.id);
  });

  await t.test('派单人自派自接时可以关联本人的送心号', async () => {
    await add(dispatcher, '派单人自用号');
    const [personal] = await listPersonal(dispatcher);
    const order = await publish({ fromClient: true });
    const own = await claim(order, dispatcher, 0, 2);
    const linked = await link(order, own, dispatcher, personal.id);
    assert.equal(linked.userId, dispatcher.id);
    assert.deepEqual(executorShares(await detail(dispatcher, order))[0].executionGameAccounts, [linked]);
  });

  await t.test('历史按颗订单读取原送心账号标识并保持原始快照', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const shareId = new mongoose.Types.ObjectId();
    const historical = { _id: new mongoose.Types.ObjectId(), name: '旧版执行号' };
    await db.collection('club_orders').insertOne({
      _id: orderId, clubId: 'club', source: 'direct_dispatch', businessType: 'heart_delivery',
      createdAt: new Date(), createdByUserId: dispatcher.id, dispatcherUserId: dispatcher.id, requestId: randomUUID(),
      customerLinkStatus: 'verified', customerUserId: customer.id, recipientGameAccount: '旧接收号',
      dispatchStatus: 'published', heartDelivery: { requestedHearts: 10 },
      shares: [{ _id: shareId, userId: first.id, hearts: 10, executionGameAccounts: [historical] }],
    });
    const route = club + '/orders/' + orderId.toHexString();
    const detail = await call(first, route);
    assert.equal(detail.requestedHearts, 10);
    assert.deepEqual(detail.shares[0].executionGameAccounts, [{ id: historical._id.toHexString(), name: historical.name }]);
  });
});
