import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startClubSystem } from './club-test-system.mjs';

const root = app => `/${app}/club/service-orders`;
const businessType = 'companionship';
const slotMs = 30 * 60 * 1000;
const firstPaymentAt = '2026-11-19T09:30:00+08:00';
const request = (body = {}) => ({ requestId: randomUUID(), ...body });
const iso = at => new Date(at).toISOString();
const slotEnd = (startAt, unit) => iso(Date.parse(startAt) + unit * slotMs);
const orderIds = page => page.items.map(order => order.id);

test('陪玩预约按半小时履约，跨实例承接隔离时段，取消保留证据', { timeout: 120_000 }, async t => {
  const { api, administrator, register, seedClub, startPeer } = await startClubSystem(t, {
    database: 'club_companionship_e2e', adminUsername: 'play_admin',
  });
  const dispatcher = await register('play_dispatcher', 'employee');
  const worker = await register('play_worker', 'employee');
  const anotherWorker = await register('play_other_worker', 'employee');
  const boss = await register('play_boss', 'client');
  const otherBoss = await register('play_other_boss', 'client');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  for (const actor of [worker, anotherWorker, administrator]) await seedClub('member', actor.id, 'active', 'member');
  for (const permission of ['CLUB_ORDERS_READ', 'CLUB_FINANCE_READ']) await seedClub('grant', administrator.id, permission);
  const peer = await startPeer();

  const get = (app, actor, path, status = 200, server) => api(app, path, { token: actor.token, status, server });
  const post = (app, actor, path, body, status = 201, server) => api(app, path, { token: actor.token, method: 'POST', body, status, server });
  const list = (app, actor, params = {}) => get(app, actor, `${root(app)}?${new URLSearchParams({ businessType, ...params })}`);
  const detail = (app, actor, id, status) => get(app, actor, `${root(app)}/${id}?businessType=${businessType}`, status);
  const create = (app, actor, input, status, server) => post(app, actor, root(app), input, status, server);
  const action = (app, actor, id, name, input, status, server) => post(app, actor, `${root(app)}/${id}/${name}`, input, status, server);
  const claim = (id, input = request(), status, server) => action('employee', worker, id, 'claim', input, status, server);
  const start = (id, input, status, server) => action('employee', worker, id, 'start', input, status, server);
  const deliver = (id, input, status, server) => action('employee', worker, id, 'deliveries', input, status, server);
  const accept = (id, input, status, server) => action('client', boss, id, 'accept', input, status, server);
  const stop = (id, reason) => action('client', boss, id, 'stop', request({ reason }));

  const booking = (recipientGameAccount, scheduledStartAt, units = 4) => request({
    businessType, recipientGameAccount, scheduledStartAt, units, serviceDescription: '陪同完成约定的双人任务',
  });
  const clientBooking = (recipient, at, units) => ({ ...booking(recipient, at, units), dispatcherUserId: dispatcher.id });
  const publish = order => action('employee', dispatcher, order.id, 'publish', request({ amountCents: 1500 * order.units, occurredAt: firstPaymentAt }));
  async function openSlot(recipient, at, units) {
    return publish(await create('client', boss, clientBooking(recipient, at, units)));
  }

  async function completeSlot(order, unit, label) {
    const finishedAt = slotEnd(order.scheduledStartAt, unit);
    const reported = await deliver(order.id, request({ unit, finishedAt, evidence: label }));
    const evidence = reported.deliveries.find(row => row.unit === unit);
    assert.deepEqual([evidence.evidence, evidence.finishedAt, evidence.acceptedAt], [label, finishedAt, undefined]);
    const accepted = await accept(order.id, request({ unit }));
    const confirmation = accepted.deliveries.find(row => row.unit === unit);
    assert.equal(confirmation.finishedAt, finishedAt);
    assert.ok(Number.isFinite(Date.parse(confirmation.acceptedAt)));
    return accepted;
  }

  await t.test('C1 老板预约四段，按实际开场和每段结束逐段验收', async () => {
    const at = '2026-11-20T20:00:00+08:00';
    const input = clientBooking('星渡', at);
    await create('client', boss, { ...input, scheduledStartAt: '2026-11-20T20:15:00+08:00' }, 400);
    await create('client', boss, { ...input, scheduledStartAt: '2026-11-20T20:00:00' }, 400);
    const order = await create('client', boss, input);
    assert.deepEqual(await create('client', boss, { ...input, scheduledStartAt: iso(at) }, 201, peer), order);
    assert.deepEqual([order.source, order.businessType, order.startDate, order.scheduledStartAt, order.scheduledEndAt, order.units],
      ['client_order', businessType, '2026-11-20', iso(at), slotEnd(at, 4), 4]);
    assert.deepEqual(order.quote, { unitPriceCents: 1500, totalCents: 6000 });
    await detail('client', otherBoss, order.id, 404);
    await detail('employee', anotherWorker, order.id, 404);

    await publish(order);
    const boardOrder = (await list('employee', worker, { scope: 'board' })).items.find(row => row.id === order.id);
    assert.equal(boardOrder.scheduledStartAt, order.scheduledStartAt);
    assert.equal(boardOrder.scheduledEndAt, order.scheduledEndAt);
    assert.equal(boardOrder.customerUserId, undefined);
    assert.equal(boardOrder.recipientGameAccount, undefined);
    const claimed = await claim(order.id);
    assert.equal(claimed.executorUserId, worker.id);
    assert.equal(claimed.recipientGameAccount, '星渡');
    assert.ok(claimed.actions.includes('start'));
    assert.ok(!claimed.actions.includes('deliveries'));
    await detail('employee', anotherWorker, order.id, 404);
    await action('employee', anotherWorker, order.id, 'start', request({ occurredAt: at }), 404);
    await deliver(order.id, request({ unit: 1, finishedAt: slotEnd(at, 1), evidence: '未开场不能交付' }), 409);
    await start(order.id, request({ occurredAt: '2026-11-20T19:59:59+08:00' }), 400);
    await start(order.id, request({ occurredAt: '2026-11-20T22:00:00+08:00' }), 400);
    const opening = request({ occurredAt: at });
    const [started, startReplay] = await Promise.all([
      start(order.id, opening), start(order.id, { ...opening, occurredAt: iso(at) }, 201, peer),
    ]);
    assert.deepEqual(startReplay, started);
    assert.equal(started.startedAt, iso(at));
    assert.ok(started.actions.includes('deliveries'));
    await start(order.id, request({ occurredAt: at }), 409);
    await start(order.id, { ...opening, occurredAt: '2026-11-20T20:01:00+08:00' }, 409);
    await deliver(order.id, request({ unit: 1, evidence: '缺少实际完成时间' }), 400);
    await deliver(order.id, request({ unit: 1, finishedAt: '2026-11-20T20:29:59+08:00', evidence: '时段未结束' }), 400);
    await deliver(order.id, request({ unit: 1, finishedAt: iso(Date.now() + 60_000), evidence: '实际完成时间在未来' }), 400);
    await deliver(order.id, request({ unit: 4, finishedAt: '2026-11-20T22:00:00.001+08:00', evidence: '超过预约结束一毫秒' }), 400);
    await deliver(order.id, request({ unit: 4, finishedAt: '2026-11-21T10:00:00+08:00', evidence: '末段实际完成时间越过预约到次日' }), 400);
    await accept(order.id, request({ unit: 1 }), 409);

    const first = request({ unit: 1, finishedAt: '2026-11-20T20:30:00+08:00', evidence: 'C1-1' });
    const [reported, reportReplay] = await Promise.all([
      deliver(order.id, first), deliver(order.id, { ...first, finishedAt: iso(first.finishedAt) }, 201, peer),
    ]);
    assert.deepEqual(reportReplay, reported);
    assert.deepEqual(reported.deliveries.map(row => [row.businessDate, row.evidence, row.finishedAt]),
      [['2026-11-20', first.evidence, iso(first.finishedAt)]]);
    await action('employee', anotherWorker, order.id, 'deliveries', first, 404);
    await action('client', otherBoss, order.id, 'accept', request({ unit: 1 }), 404);
    assert.equal((await accept(order.id, request({ unit: 1 }))).status, 'claimed');
    for (const unit of [2, 3, 4]) {
      const accepted = await completeSlot(order, unit, `C1-${unit}`);
      assert.equal(accepted.status, unit === 4 ? 'completed' : 'claimed');
    }
    const completed = await detail('admin', administrator, order.id);
    assert.deepEqual(completed.deliveries.map(row => [row.evidence, row.finishedAt]),
      [1, 2, 3, 4].map(unit => [`C1-${unit}`, slotEnd(at, unit)]));
    assert.equal(completed.startedAt, iso(at));
    assert.ok(completed.deliveries.every(row => row.acceptedAt));
    assert.ok(completed.deliveries.every(row => Date.parse(row.submittedAt) > Date.parse(order.scheduledEndAt)));
  });

  await t.test('C2 代录后提前离场，保留前两段且仅释放剩余未履约时段', async () => {
    const at = '2026-11-21T20:00:00+08:00';
    const order = await create('employee', dispatcher, { ...booking('星港', at), customerUserId: boss.id });
    assert.deepEqual([order.source, order.customerUserId, order.dispatcherUserId, order.scheduledEndAt],
      ['direct_dispatch', boss.id, dispatcher.id, slotEnd(at, 4)]);
    await publish(order);
    await claim(order.id);
    await start(order.id, request({ occurredAt: at }));
    await completeSlot(order, 1, 'C2-1');
    const accepted = await completeSlot(order, 2, 'C2-2');

    const later = await openSlot('星港后两段', '2026-11-21T21:00:00+08:00', 2);
    await claim(later.id, request(), 409);
    await action('client', otherBoss, order.id, 'stop', request({ reason: '其他客户无权取消' }), 404);
    const stopped = await stop(order.id, '21:00 提前离场，取消后两段');
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.startedAt, iso(at));
    assert.deepEqual(stopped.deliveries, accepted.deliveries);
    assert.equal(stopped.stop.reason, '21:00 提前离场，取消后两段');
    await deliver(order.id, request({ unit: 3, finishedAt: slotEnd(at, 3), evidence: '停单后不可填报' }), 409);
    await accept(order.id, request({ unit: 3 }), 409);
    assert.equal((await claim(later.id)).executorUserId, worker.id);
    const earlier = await openSlot('星港已履约时段', '2026-11-21T20:30:00+08:00', 1);
    await claim(earlier.id, request(), 409);
  });

  await t.test('双实例争抢重叠预约，紧邻可接，未开场取消释放全部占用', async () => {
    const future = iso(Math.ceil(Date.now() / slotMs) * slotMs + slotMs);
    const first = await openSlot('同时预约甲', future, 2);
    const second = await openSlot('同时预约乙', future, 2);
    const claims = [request(), request()];
    const result = await Promise.all([claim(first.id, claims[0], [201, 409]), claim(second.id, claims[1], [201, 409], peer)]);
    assert.equal(result.filter(Boolean).length, 1);
    const winner = result.find(Boolean);
    assert.equal(winner.executorUserId, worker.id);
    const loserIndex = result.findIndex(row => !row);
    const loser = [first, second][loserIndex];
    assert.equal((await detail('client', boss, loser.id)).status, 'published');

    const adjacent = await openSlot('紧邻预约', slotEnd(future, 2), 1);
    assert.equal((await claim(adjacent.id)).executorUserId, worker.id);
    await start(winner.id, request({ occurredAt: future }), 400);
    const cancelled = await stop(winner.id, '预约开始前取消');
    assert.equal(cancelled.status, 'stopped');
    assert.equal(cancelled.startedAt, undefined);
    assert.deepEqual(cancelled.deliveries, []);
    assert.equal((await claim(loser.id, claims[loserIndex], 201, peer)).executorUserId, worker.id);
  });

  await t.test('迟到与跨北京业务日按完整时段计，已提交但未验收的时段仍占用', async () => {
    const at = '2026-11-22T23:30:00+08:00';
    const order = await openSlot('跨日预约', at, 2);
    await claim(order.id);
    await start(order.id, request({ occurredAt: '2026-11-22T23:40:00+08:00' }));
    await deliver(order.id, request({ unit: 1, finishedAt: slotEnd(at, 1), evidence: '实际开场未完整覆盖第一段' }), 409);
    const submitted = await deliver(order.id, request({ unit: 2, finishedAt: slotEnd(at, 2), evidence: '跨日完整交付' }));
    assert.deepEqual(submitted.deliveries.map(row => [row.unit, row.businessDate, row.acceptedAt]), [[2, '2026-11-23', undefined]]);
    const cancelled = await stop(order.id, '客户尚未验收就停单');
    assert.deepEqual(cancelled.deliveries, submitted.deliveries);
    const released = await openSlot('跨日未提交时段', at, 1);
    assert.equal((await claim(released.id)).executorUserId, worker.id);
    const held = await openSlot('跨日已提交时段', slotEnd(at, 1), 1);
    await claim(held.id, request(), 409);
  });

  await t.test('列表与显式详情按业务类型隔离，旧客户端默认代跑', async () => {
    const daily = await create('client', boss, request({ businessType: 'daily_run', recipientGameAccount: '代跑隔离样单',
      serviceDescription: '完成地图路线', startDate: '2026-11-20', units: 1, dispatcherUserId: dispatcher.id }));
    const gift = await post('client', boss, '/client/orders', request({ recipientGameAccount: '送心隔离样单',
      requestedGiftTimes: 3, dispatcherUserId: dispatcher.id }));
    const legacy = await get('client', boss, root('client'));
    assert.deepEqual(orderIds(legacy), [daily.id]);
    const companionship = await list('client', boss);
    assert.ok(companionship.items.length > 0);
    assert.ok(companionship.items.every(row => row.businessType === businessType));
    const sample = companionship.items[0];
    assert.ok(!orderIds(companionship).includes(daily.id));
    assert.ok(!orderIds(companionship).includes(gift.id));
    assert.equal((await get('client', boss, `${root('client')}/${sample.id}`)).businessType, businessType);
    await get('client', boss, `${root('client')}/${sample.id}?businessType=daily_run`, 404);
    await detail('client', boss, daily.id, 404);
    await detail('client', boss, gift.id, 404);
    await get('client', boss, `/client/orders/${sample.id}`, 404);
    assert.ok((await list('admin', administrator)).items.every(row => row.businessType === businessType));
  });
});
