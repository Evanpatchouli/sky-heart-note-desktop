import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { startClubSystem } from './club-test-system.mjs';

test('两种来源的历史按颗派单保留原承接、核款和审核口径', { timeout: 120000 }, async (t) => {
  const { db, api, administrator, register, seedClub } = await startClubSystem(t, {
    database: 'club_dispatch_e2e', adminUsername: 'dispatch_admin',
  });
  const dispatcher = await register('dispatch_host', 'employee');
  const first = await register('dispatch_first', 'employee');
  const second = await register('dispatch_second', 'employee');
  const racer = await register('dispatch_racer', 'employee');
  const outsider = await register('dispatch_outside', 'employee');
  const customer = await register('dispatch_customer', 'client');
  const member = (actor, status = 'active', mark = 'member') => seedClub('member', actor.id, status, mark);
  await seedClub('name', '送心俱乐部');
  for (const actor of [administrator, first, second, racer]) await member(actor);
  await member(dispatcher, 'active', 'dispatcher');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await seedClub('grant', administrator.id, 'CLUB_ORDERS_READ');
  await db.collection('users').updateMany({ _id: { $in: [first.id, second.id] } }, { $set: { nickname: '同名团员' } });

  const employee = '/employee/club';
  const employeeOrders = employee + '/orders';
  const board = employee + '/claim-board';
  const clientOrders = '/client/orders';
  const stored = (id) => db.collection('club_orders').findOne({ _id: new mongoose.Types.ObjectId(id) });
  const request = (app, path, actor, method, body, status, message) => api(app, path, {
    token: actor.token, method, body, status, message,
  });
  const employeeGet = (route, actor, status, message) => request('employee', route, actor, 'GET', undefined, status, message);
  const orderRoute = (order) => employeeOrders + '/' + order.id;
  const boardRoute = (order) => board + '/' + order.id;
  // These records represent orders created before new quotes switched to gift times.
  const collection = db.collection('club_orders');
  const create = async (source) => {
    const _id = new mongoose.Types.ObjectId();
    const order = {
      _id, clubId: 'club', source, recipientGameAccount: '不公开的游戏账号', businessType: 'heart_delivery',
      requestId: randomUUID(), customerUserId: customer.id, customerLinkStatus: 'verified',
      createdByUserId: source === 'direct_dispatch' ? dispatcher.id : customer.id,
      dispatcherUserId: dispatcher.id, dispatcherAssignment: source === 'direct_dispatch' ? 'creator' : 'customer_selected',
      dispatchStatus: source === 'direct_dispatch' ? 'draft' : 'pending',
      heartDelivery: { requestedHearts: 100 }, shares: [], createdAt: new Date(),
    };
    await collection.insertOne(order);
    return { ...order, id: _id.toHexString() };
  };
  const price = (order) => collection.updateOne({ _id: order._id }, { $set: { pricing: {
    revision: 1, ruleVersion: 1, basis: 'received_hearts', dispatchFeeCents: 5,
    segments: [{ period: 'normal', hearts: 100, unitPriceCents: 50 }],
  } } });
  const record = (order) => request('employee', orderRoute(order) + '/receipts', dispatcher, 'POST', {
    requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 5000, receivedAt: '2026-11-24T19:40:00+08:00',
  }, 201);
  const publication = (publicHearts, directed = []) => ({
    requestId: randomUUID(), publicHearts, directed, pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
  });
  const publish = (order, input, actor = dispatcher, status = 201, message) =>
    request('employee', orderRoute(order) + '/publish', actor, 'POST', input, status, message);
  const claimInput = (hearts, kind = 'public') => ({ requestId: randomUUID(), kind, hearts });
  const claim = (order, actor, input, status = 201, message) =>
    request('employee', boardRoute(order) + '/claims', actor, 'POST', input, status, message);
  const directed = (actor, hearts) => ({ userId: actor.id, hearts });
  const preparation = (order) => employeeGet(orderRoute(order) + '/pricing', dispatcher);
  const counts = ({ publicRemainingHearts, directedPendingHearts, claimedHearts }) =>
    [publicRemainingHearts, directedPendingHearts, claimedHearts];

  async function publishHistorical(order, input) {
    const { receipt } = await stored(order.id);
    const { revision, segments } = receipt.quote;
    const dispatchPricing = { revision, segments, basis: 'received_hearts', version: 1,
      clubFeeCents: 5, dispatchFeeCents: 5 };
    await collection.updateOne({ _id: order._id }, { $set: {
      dispatchStatus: 'published', publishedAt: new Date(), dispatchPricing,
      allocation: { requestId: input.requestId, publicHearts: input.publicHearts,
        directed: [...input.directed].sort((a, b) => a.userId.localeCompare(b.userId)),
        publicRemainingHearts: input.publicHearts },
    }, $unset: { pricing: '' } });
    return publish(order, input);
  }

  await t.test('历史直接单保留 50 颗公开、50 颗定向，两名未标记团员分别主动承接', async () => {
    const order = await create('direct_dispatch');
    const input = publication(50, [directed(first, 50)]);
    assert.deepEqual((await employeeGet(board, first)).items, []);
    await employeeGet(boardRoute(order), first, 404, /没有可查看的已发布派单/);
    await claim(order, first, claimInput(50, 'directed'), 404, /没有可查看的已发布派单/);
    await publish(order, input, dispatcher, 409, /报价未准备/);
    await price(order);
    const receipt = await record(order);
    assert.deepEqual((await employeeGet(board, first)).items, []);
    assert.equal((await stored(order.id)).allocation, undefined);

    const recipients = await employeeGet(employee + '/dispatch-recipients', dispatcher);
    assert.deepEqual(new Set(recipients.filter(({ nickname }) => nickname === '同名团员').map(({ userId }) => userId)),
      new Set([first.id, second.id]));
    assert.ok(recipients.every(({ userId }) => ![dispatcher.id, outsider.id, customer.id].includes(userId)));
    await employeeGet(employee + '/dispatch-recipients', outsider, 403, /有效成员/);
    await publish(order, input, first, 404, /订单不存在/);
    await publish(order, input, customer, 403);
    await publish(order, { ...input, dispatcherUserId: first.id }, dispatcher, 400);
    await publish(order, { ...input, directed: [null] }, dispatcher, 400);
    for (const target of [outsider, customer]) {
      await publish(order, publication(50, [directed(target, 50)]), dispatcher, 400, /有效团员/);
    }
    await publish(order, publication(50, [directed(dispatcher, 50)]), dispatcher, 409, /自派自接规则待确认/);
    await publish(order, publication(50, [directed(first, 25), directed(first, 25)]), dispatcher, 400, /只能指定一份/);
    await publish(order, publication(51, [directed(first, 50)]), dispatcher, 400, /合计须等于订购颗数/);
    await member(first, 'inactive');
    await publish(order, input, dispatcher, 400, /有效团员/);
    await member(first);

    const published = await publishHistorical(order, input);
    const repeated = await publish(order, input);
    assert.deepEqual(published, repeated);
    assert.equal(published.source, 'direct_dispatch');
    assert.equal(published.dispatchStatus, 'published');
    const current = await stored(order.id);
    assert.equal(current.publishedAt.toISOString(), published.publishedAt);
    assert.deepEqual(current.receipt.quote, receipt.receipt.quote);
    assert.equal(current.receipt.receivedAmountCents, 5000);
    assert.deepEqual(current.dispatchPricing, published.dispatchPricing);
    assert.deepEqual(current.allocation, { ...published.allocation, publicRemainingHearts: 50 });
    await publish(order, { ...input, directed: [directed(second, 50)] }, dispatcher, 409, /内容不同/);
    await publish(order, publication(100), dispatcher, 409, /订单已派发/);

    const listed = (await employeeGet(board, second)).items[0];
    assert.equal(listed.id, order.id);
    assert.equal(listed.publicRemainingHearts, 50);
    assert.equal(listed.directedPendingHearts, 0);
    assert.equal(listed.recipientGameAccount, undefined);
    assert.equal(listed.customerUserId, undefined);
    assert.equal(listed.receipt, undefined);
    assert.equal(listed.dispatchPricing, undefined);
    const initial = await employeeGet(boardRoute(order), first);
    assert.equal(initial.directedPendingHearts, 50);
    assert.equal(initial.myClaimedHearts, 0);
    assert.equal((await stored(order.id)).shares.length, 0);
    assert.deepEqual(counts((await preparation(order)).allocation), [50, 50, 0]);
    await employeeGet(board, outsider, 403);
    await employeeGet('/employee/clubs/other/claim-board/' + order.id, outsider, 404);
    await claim(order, outsider, claimInput(50), 403);
    await claim(order, dispatcher, claimInput(50), 409, /自派自接规则待确认/);
    await claim(order, second, claimInput(50, 'directed'), 403, /没有指定给你/);
    await claim(order, first, claimInput(49, 'directed'), 409, /按指定的颗数/);
    await claim(order, first, { ...claimInput(50, 'directed'), userId: second.id }, 400);
    await member(first, 'inactive');
    await claim(order, first, claimInput(50, 'directed'), 403, /有效成员/);
    await member(first);

    const assign = claimInput(50, 'directed');
    const [accepted, duplicate, grabbed] = await Promise.all([
      claim(order, first, assign),
      claim(order, first, assign),
      claim(order, second, claimInput(50)),
    ]);
    assert.deepEqual(accepted, duplicate);
    assert.notEqual(accepted.id, grabbed.id);
    assert.deepEqual([accepted.hearts, grabbed.hearts], [50, 50]);
    assert.deepEqual([accepted.userId, grabbed.userId], [first.id, second.id]);
    await claim(order, first, claimInput(50, 'directed'), 409, /已接受/);
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 0, 100]);
    assert.deepEqual((await stored(order.id)).shares.map(({ hearts }) => hearts), [50, 50]);
    for (const actor of [first, second]) {
      const mine = await employeeGet(orderRoute(order), actor);
      assert.deepEqual(mine.shares.map(({ userId, hearts }) => [userId, hearts]), [[actor.id, 50]]);
      assert.equal(mine.recipientGameAccount, '不公开的游戏账号');
    }
    assert.deepEqual(await publish(order, input), published);
  });

  await t.test('客户端正式发布后可追加公开份额，同键重放返回原次结果，最后 50 颗只成交一次', async () => {
    const order = await create('client_order');
    assert.equal(order.dispatchStatus, 'pending');
    await claim(order, second, claimInput(50), 404, /没有可查看的已发布派单/);
    await price(order);
    await record(order);
    const input = publication(100);
    await publish(order, input, racer, 404);
    const published = await publishHistorical(order, input);
    assert.equal(published.source, 'client_order');
    const twenty = claimInput(20);
    const thirty = claimInput(30);
    const firstClaim = await claim(order, first, twenty);
    const [secondClaim, replay] = await Promise.all([claim(order, first, thirty), claim(order, first, thirty)]);
    assert.deepEqual(replay, secondClaim);
    assert.deepEqual(await claim(order, first, twenty), firstClaim);
    await claim(order, first, { ...twenty, hearts: 21 }, 409, /内容不同/);
    assert.equal((await employeeGet(boardRoute(order), first)).myClaimedHearts, 50);
    assert.deepEqual(counts((await preparation(order)).allocation), [50, 0, 50]);
    const lastRequest = claimInput(50);
    const results = await Promise.all([
      claim(order, second, lastRequest, [201, 409]),
      claim(order, racer, lastRequest, [201, 409]),
    ]);
    const [winner] = results.filter(Boolean);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(winner.hearts, 50);
    const winningActor = winner.userId === second.id ? second : racer;
    const loser = winningActor === second ? racer : second;
    assert.deepEqual(await claim(order, winningActor, lastRequest), winner);
    await claim(order, loser, lastRequest, 409, /可领份额已变化/);
    for (const [actor, claimed] of [[winningActor, 50], [loser, 0]]) {
      const latest = await employeeGet(boardRoute(order), actor);
      assert.deepEqual([latest.publicRemainingHearts, latest.directedPendingHearts, latest.myClaimedHearts], [0, 0, claimed]);
    }
    const saved = await stored(order.id);
    assert.equal(saved.shares.length, 3);
    assert.equal(saved.shares.filter(({ claimRequestId }) => claimRequestId === lastRequest.requestId).length, 1);
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 0, 100]);
    const customerOrder = await request('client', clientOrders + '/' + order.id, customer, 'GET');
    assert.equal(customerOrder.source, 'client_order');
    assert.equal(customerOrder.dispatchStatus, 'published');
    assert.equal(customerOrder.quote.totalAmountCents, 5000);
    assert.equal(customerOrder.receipt.receivedAmountCents, 5000);
    assert.equal(customerOrder.allocation, undefined);
    assert.equal(customerOrder.shares, undefined);
  });

  await t.test('公开余量不足时整笔拒绝，重新选择后可领取，定向与派单款项可核对', async () => {
    const order = await create('direct_dispatch');
    await price(order);
    await record(order);
    await publishHistorical(order, publication(70, [directed(first, 30)]));
    const before = await preparation(order);
    const original = await employeeGet(boardRoute(order), first);
    assert.deepEqual([original.publicRemainingHearts, original.directedPendingHearts], [70, 30]);

    await claim(order, second, claimInput(40));
    const stale = claimInput(50);
    await claim(order, first, stale, 409, /可领份额已变化/);
    const latest = await employeeGet(boardRoute(order), first);
    assert.deepEqual([latest.publicRemainingHearts, latest.directedPendingHearts, latest.myClaimedHearts], [30, 30, 0]);
    assert.deepEqual(counts((await preparation(order)).allocation), [30, 30, 40]);

    const updated = claimInput(30);
    await claim(order, first, updated); // 模拟调用方没有拿到领取结果。
    const after = await employeeGet(boardRoute(order), first);
    assert.deepEqual([after.publicRemainingHearts, after.directedPendingHearts, after.myClaimedHearts], [0, 30, 30]);
    const recovered = await claim(order, first, updated);
    const claimed = (await stored(order.id)).shares.filter(({ userId }) => userId === first.id);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].claimRequestId, updated.requestId);
    assert.equal(recovered.id, claimed[0]._id.toHexString());
    assert.equal(recovered.claimedAt, claimed[0].claimedAt.toISOString());
    assert.deepEqual([recovered.kind, recovered.hearts], ['public', 30]);

    await claim(order, first, claimInput(30, 'directed'));
    const final = await preparation(order);
    assert.deepEqual(counts(final.allocation), [0, 0, 100]);
    assert.deepEqual(final.quote, before.quote);
    assert.deepEqual(final.receipt, before.receipt);
    assert.deepEqual([final.quote.heartsAmountCents, final.receipt.receivedAmountCents], [5000, 5000]);
  });

  await t.test('先抢公开余量仍可确认本人的定向份额，历史已派发订单保留原有查看范围', async () => {
    const order = await create('direct_dispatch');
    await price(order);
    await record(order);
    const input = publication(20, [directed(first, 40), directed(second, 40)]);
    await publishHistorical(order, input);
    await claim(order, first, claimInput(20));
    const firstView = await employeeGet(boardRoute(order), first);
    assert.equal(firstView.myClaimedHearts, 20);
    assert.equal(firstView.directedPendingHearts, 40);
    assert.equal((await employeeGet(boardRoute(order), second)).directedPendingHearts, 40);
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 80, 20]);
    await claim(order, first, claimInput(40, 'directed'));
    assert.equal((await employeeGet(boardRoute(order), first)).myClaimedHearts, 60);
    assert.equal((await employeeGet(boardRoute(order), first)).directedPendingHearts, 0);
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 40, 60]);

    // 模拟旧版已派发、有规则和承接记录、尚无公开授权的订单。
    const current = await stored(order.id);
    const oldShares = current.shares.map(({ _id, userId, hearts, executionGameAccounts }) =>
      ({ _id, userId, hearts, executionGameAccounts }));
    await db.collection('club_orders').updateOne({ _id: current._id }, {
      $unset: { allocation: '' }, $set: { shares: oldShares },
    });
    await publish(order, input, dispatcher, 409, /历史订单已派发/);
    await claim(order, second, claimInput(40), 404, /没有可查看的已发布派单/);
    assert.ok(!(await employeeGet(board, first)).items.some(({ id }) => id === order.id));
    assert.deepEqual((await employeeGet(orderRoute(order), first)).shares.map(({ hearts }) => hearts), [20, 40]);
    assert.deepEqual((await preparation(order)).dispatchPricing, current.dispatchPricing);
  });

  await t.test('纯定向订单给两人各 50 颗，只允许两名指定团员查看和确认', async () => {
    const order = await create('direct_dispatch');
    await price(order);
    await record(order);
    const input = publication(0, [directed(first, 50), directed(second, 50)]);
    const published = await publishHistorical(order, input);
    assert.deepEqual(await publish(order, { ...input, directed: [...input.directed].reverse() }), published);
    assert.ok(!(await employeeGet(board, racer)).items.some(({ id }) => id === order.id));
    await employeeGet(boardRoute(order), racer, 404, /没有可查看的已发布派单/);
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 100, 0]);
    for (const actor of [first, second]) {
      const detail = await employeeGet(boardRoute(order), actor);
      assert.equal(detail.directedPendingHearts, 50);
      await claim(order, actor, claimInput(50, 'directed'));
    }
    assert.deepEqual(counts((await preparation(order)).allocation), [0, 0, 100]);
  });
});
