import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startClubSystem } from './club-test-system.mjs';

const root = app => `/${app}/club/service-orders`;
const businessType = 'daily_run';
const startDate = '2026-11-20';
const firstPayment = { amountCents: 6000, occurredAt: '2026-11-19T09:30:00+08:00' };
const versionOneRequestId = '8eb5aafe-7aed-11ef-9bfc-0242ac120002';
const request = (body = {}) => ({ requestId: randomUUID(), ...body });
const orderIds = page => page.items.map(order => order.id);
const promisedService = recipientGameAccount => request({
  businessType, recipientGameAccount, serviceDescription: '按每日路线完成约定跑图并提交凭据', startDate, units: 3,
});

test('代跑走独立订单入口，保留归属、逐日验收、退款和入账权限', { timeout: 120_000 }, async t => {
  const { api, administrator, login, register, seedClub, startPeer, restartServer } = await startClubSystem(t, {
    database: 'club_service_orders_e2e', adminUsername: 'run_admin',
  });
  const leader = await login('employee', 'run_admin');
  const dispatcher = await register('run_dispatcher', 'employee');
  const deputy = await register('run_deputy', 'employee');
  const runnerA = await register('run_executor_a', 'employee');
  const runnerB = await register('run_executor_b', 'employee');
  const nonmember = await register('run_nonmember', 'employee');
  const boss = await register('run_boss', 'client');
  const otherBoss = await register('run_other_boss', 'client');
  const operations = await register('run_operations', 'admin');
  const financeOnly = await register('run_finance', 'admin');
  for (const actor of [leader, dispatcher, deputy, runnerA, runnerB, operations, financeOnly]) {
    await seedClub('member', actor.id, 'active', 'member');
  }
  await seedClub('position', leader.id, 'leader');
  await seedClub('position', deputy.id, 'deputy');
  for (const permission of ['CLUB_ORDERS_READ', 'CLUB_FINANCE_READ']) await seedClub('grant', administrator.id, permission);
  await seedClub('grant', operations.id, 'CLUB_ORDERS_READ');
  await seedClub('grant', financeOnly.id, 'CLUB_FINANCE_READ');
  const peer = await startPeer();

  const read = (app, actor, path, status = 200, server) => api(app, path, { token: actor.token, status, server });
  const post = (app, actor, path, body, status = 201, server) => api(app, path, { token: actor.token, method: 'POST', body, status, server });
  const list = (app, actor, params = {}, status) => read(app, actor, `${root(app)}?${new URLSearchParams({ businessType, ...params })}`, status);
  const detail = (app, actor, id, status, server) => read(app, actor, `${root(app)}/${id}`, status, server);
  const create = (app, actor, input, status, server) => post(app, actor, root(app), input, status, server);
  const action = (app, actor, id, name, input, status, server) => post(app, actor, `${root(app)}/${id}/${name}`, input, status, server);
  const publish = (id, input = request(firstPayment), status, server) => action('employee', dispatcher, id, 'publish', input, status, server);
  const deliver = (worker, id, input, status, server) => action('employee', worker, id, 'deliveries', input, status, server);
  const accept = (id, input, status, server) => action('client', boss, id, 'accept', input, status, server);
  const refund = (id, input, status, server) => action('employee', dispatcher, id, 'refund', input, status, server);
  const close = (id, input, status, server) => action('employee', dispatcher, id, 'close', input, status, server);
  const financeDetail = (id, actor = financeOnly, status) => read('admin', actor, `${root('admin')}/${id}?scope=finance`, status);
  const personalBalance = actor => read('employee', actor, '/employee/club/balance');
  const clubBalance = () => read('admin', financeOnly, '/admin/club/balance');
  const balances = worker => Promise.all([personalBalance(dispatcher), personalBalance(worker), clubBalance()]);
  const orderEntries = (balance, id) => balance.entries.filter(row => row.orderId === id && row.businessType === businessType);
  const withdrawal = (actor, amountCents, status) => post('employee', actor, '/employee/club/withdrawals', request({ amountCents }), status);

  function cash({ accounting: { status, acceptedUnits, receivedCents, refundDueCents, refundedCents, refundRemainingCents, netReceivedCents } }) {
    return [status, acceptedUnits, receivedCents, refundDueCents, refundedCents, refundRemainingCents, netReceivedCents];
  }

  function split({ accounting: { dispatchFeeCents, rewardCents, clubFeeCents, allocatedCents } }) {
    return [dispatchFeeCents, rewardCents, clubFeeCents, allocatedCents];
  }

  function assertCustomerAccounting(order, expectedCash) {
    assert.deepEqual(cash(order), expectedCash);
    assert.deepEqual(split(order), [undefined, undefined, undefined, undefined]);
    assert.equal(order.accounting.refunds, undefined);
  }

  async function closeTwice(id, input) {
    const [closed, repeated] = await Promise.all([close(id, input), close(id, input, 201, peer)]);
    assert.deepEqual(repeated, closed);
    assert.equal(closed.accounting.status, 'closed');
    assert.ok(Number.isFinite(Date.parse(closed.accounting.closedAt)));
    await close(id, request(), 409);
    return closed;
  }

  async function assertPostings(id, worker, prior, closeInput, closedAt, amounts) {
    const posted = await balances(worker);
    const kinds = ['service_dispatch_fee', 'service_reward', 'service_club_fee'];
    assert.deepEqual(posted.map((account, index) => account.balanceCents - prior[index].balanceCents), amounts);
    for (const [index, account] of posted.entries()) {
      const entries = orderEntries(account, id);
      assert.deepEqual(entries.map(row => [row.kind, row.amountCents, row.closeRequestId, row.occurredAt]),
        [[kinds[index], amounts[index], closeInput.requestId, closedAt]]);
      assert.ok(entries[0].eventId);
    }
    for (const [actor, account] of [[dispatcher, posted[0]], [worker, posted[1]]]) {
      const byFinance = await read('admin', financeOnly, `/admin/club/balance/members/${actor.id}`);
      assert.deepEqual(orderEntries(byFinance, id), orderEntries(account, id));
    }
  }

  async function publishAndClaim(order, worker = runnerA) {
    const published = await publish(order.id);
    assert.equal(published.status, 'published');
    const claimed = await action('employee', worker, order.id, 'claim', request());
    assert.equal(claimed.executorUserId, worker.id);
    return claimed;
  }

  await t.test('无可选派单人时入待分配，副团长分配与老板无款取消保留原记录', async () => {
    assert.deepEqual(await list('client', boss), { items: [], nextCursor: null });
    await list('employee', nonmember, { scope: 'board' }, 403);
    await list('admin', financeOnly, {}, 403);
    await read('employee', dispatcher, root('client'), 403);
    await list('client', boss, { businessType: 'heart_delivery' }, 400);
    await create('client', boss, { ...promisedService('非 v4 请求编号'), requestId: versionOneRequestId }, 400);
    assert.deepEqual(await list('client', boss), { items: [], nextCursor: null });

    const unassigned = await create('client', boss, promisedService('等待团长分配'));
    assert.equal(unassigned.status, 'pending_assignment');
    assert.equal(unassigned.dispatcherUserId, null);
    for (const actor of [financeOnly, administrator]) {
      assert.ok(!orderIds(await list('admin', actor, { scope: 'finance' })).includes(unassigned.id));
      await financeDetail(unassigned.id, actor, 404);
    }
    assert.ok(orderIds(await list('employee', leader, { scope: 'dispatch' })).includes(unassigned.id));
    assert.ok(!orderIds(await list('employee', runnerA, { scope: 'dispatch' })).includes(unassigned.id));
    await action('employee', runnerA, unassigned.id, 'assign', request({ dispatcherUserId: runnerA.id }), 403);
    const assignment = request({ dispatcherUserId: dispatcher.id });
    const assigned = await action('employee', deputy, unassigned.id, 'assign', assignment);
    assert.equal(assigned.status, 'pending_dispatch');
    assert.equal(assigned.dispatcherUserId, dispatcher.id);
    assert.equal(assigned.source, 'client_order');
    assert.deepEqual(await action('employee', deputy, unassigned.id, 'assign', assignment, 201, peer), assigned);
    assert.equal((await detail('admin', administrator, assigned.id)).status, 'pending_dispatch');
    for (const actor of [financeOnly, administrator]) {
      assert.ok(!orderIds(await list('admin', actor, { scope: 'finance' })).includes(assigned.id));
      await financeDetail(assigned.id, actor, 404);
    }

    await publishAndClaim(assigned);
    const evidence = '仅当事人可查的分配后履约凭据';
    await deliver(runnerA, assigned.id, request({ unit: 1, evidence }));
    const accepted = await accept(assigned.id, request({ unit: 1 }));
    assert.equal(accepted.executorUserId, runnerA.id);
    assert.equal(accepted.deliveries[0].evidence, evidence);
    assert.ok(accepted.deliveries[0].acceptedAt);
    assert.deepEqual(await action('employee', deputy, assigned.id, 'assign', assignment, 201, peer), assigned);
    const stopReason = '仅当事人可查的分配后停单说明';
    const laterStop = await action('client', boss, assigned.id, 'stop', request({ reason: stopReason }));
    assert.equal(laterStop.status, 'stopped');
    assert.equal(laterStop.stop.reason, stopReason);
    assert.deepEqual(laterStop.deliveries, accepted.deliveries);
    assert.deepEqual(await action('employee', deputy, assigned.id, 'assign', assignment, 201, peer), assigned);
    await detail('employee', deputy, assigned.id, 404);

    const unreceived = await create('client', boss, promisedService('未付款取消'));
    await financeDetail(unreceived.id, financeOnly, 404);
    const cancelled = await action('client', boss, unreceived.id, 'stop', request({ reason: '行程调整，未转账' }));
    assert.equal(cancelled.status, 'stopped');
    assert.equal(cancelled.receipt, undefined);
    assert.deepEqual(cancelled.deliveries, []);
    assert.equal(cancelled.stop.reason, '行程调整，未转账');
    for (const actor of [financeOnly, administrator]) {
      const voidOrder = await financeDetail(unreceived.id, actor);
      assert.equal(voidOrder.accounting.status, 'void');
      assert.equal(voidOrder.accounting.acceptedUnits, 0);
      assert.deepEqual((await list('admin', actor, { scope: 'finance' })).items.find(row => row.id === unreceived.id), voidOrder);
    }
    for (const account of await balances(runnerA)) assert.deepEqual(orderEntries(account, unreceived.id), []);
  });

  await seedClub('member', dispatcher.id, 'active', 'dispatcher');

  await t.test('R1 老板下三日跑图，双实例抢单仅一人成功，三份凭据逐日验收', async () => {
    await create('client', boss, { ...promisedService('无派单标记的候选人'), dispatcherUserId: runnerA.id }, 400);
    const input = { ...promisedService('晨云'), dispatcherUserId: dispatcher.id };
    const order = await create('client', boss, input);
    assert.deepEqual(await create('client', boss, input, 201, peer), order);
    await create('client', boss, { ...input, units: 4 }, 409);
    assert.deepEqual([order.businessType, order.source, order.status, order.customerUserId, order.dispatcherUserId,
      order.recipientGameAccount, order.startDate, order.units, order.serviceDescription],
    [businessType, 'client_order', 'pending_dispatch', boss.id, dispatcher.id, '晨云', startDate, 3, input.serviceDescription]);
    assert.deepEqual(order.quote, { unitPriceCents: 2000, totalCents: 6000 });
    assert.ok(!orderIds(await list('employee', runnerA, { scope: 'board' })).includes(order.id));
    await detail('client', otherBoss, order.id, 404);
    await detail('employee', runnerA, order.id, 404);
    await action('employee', runnerA, order.id, 'publish', request(firstPayment), 404);
    await action('employee', runnerA, order.id, 'claim', request(), 404);
    await accept(order.id, request({ unit: 1 }), 409);
    await publish(order.id, { ...firstPayment, requestId: versionOneRequestId }, 400);
    await publish(order.id, request({ ...firstPayment, amountCents: 5999 }), 400);
    await publish(order.id, request({ ...firstPayment, occurredAt: new Date(Date.now() + 60_000).toISOString() }), 400);
    assert.equal((await detail('employee', dispatcher, order.id)).receipt, undefined);

    const payment = request(firstPayment);
    const published = await publish(order.id, payment);
    assert.deepEqual(await publish(order.id, payment, 201, peer), published);
    assert.deepEqual(published.receipt, { amountCents: 6000, occurredAt: new Date(firstPayment.occurredAt).toISOString() });
    const board = await list('employee', runnerA, { scope: 'board' });
    const boardOrder = board.items.find(row => row.id === order.id);
    assert.equal(boardOrder?.status, 'published');
    assert.ok(boardOrder.actions.includes('claim'));
    assert.equal(boardOrder.quote, undefined);
    assert.equal(boardOrder.receipt, undefined);
    assert.equal(boardOrder.customerUserId, undefined);
    assert.equal(boardOrder.recipientGameAccount, undefined);
    assert.deepEqual(await detail('employee', runnerA, order.id), boardOrder);

    const claims = [request(), request()];
    const contenders = [runnerA, runnerB];
    const wins = await Promise.all(contenders.map((actor, index) =>
      action('employee', actor, order.id, 'claim', claims[index], [201, 409], index ? peer : undefined)));
    assert.equal(wins.filter(Boolean).length, 1);
    const winnerIndex = wins.findIndex(Boolean);
    const winner = contenders[winnerIndex];
    const loser = contenders[1 - winnerIndex];
    assert.equal(wins[winnerIndex].executorUserId, winner.id);
    assert.deepEqual(await action('employee', winner, order.id, 'claim', claims[winnerIndex], 201, peer), wins[winnerIndex]);
    assert.deepEqual([wins[winnerIndex].customerUserId, wins[winnerIndex].recipientGameAccount], [boss.id, '晨云']);
    assert.deepEqual(await detail('employee', winner, order.id), wins[winnerIndex]);
    assert.ok(!orderIds(await list('employee', loser, { scope: 'board' })).includes(order.id));
    assert.ok(!orderIds(await list('employee', loser, { scope: 'mine' })).includes(order.id));
    assert.deepEqual((await list('employee', winner, { scope: 'mine' })).items.find(row => row.id === order.id), wins[winnerIndex]);
    await detail('employee', loser, order.id, 404);
    await deliver(loser, order.id, request({ unit: 1, evidence: '不属于本单的凭据' }), 404);
    await deliver(winner, order.id, request({ unit: 4, evidence: '超过约定天数' }), 400);
    await accept(order.id, request({ unit: 1 }), 409);

    for (const [unit, day] of [[1, 20], [2, 21], [3, 22]]) {
      const report = request({ unit, evidence: `R1-${day}` });
      const [original, repeated] = await Promise.all([deliver(winner, order.id, report), deliver(winner, order.id, report, 201, peer)]);
      assert.deepEqual(repeated, original);
      assert.equal(original.deliveries.length, unit);
      const delivery = original.deliveries.find(row => row.unit === unit);
      assert.deepEqual([delivery.businessDate, delivery.evidence, delivery.acceptedAt], [`2026-11-${day}`, `R1-${day}`, undefined]);
      assert.ok(Number.isFinite(Date.parse(delivery.submittedAt)));
      const awaitingCustomer = await detail('client', boss, order.id);
      assert.ok(awaitingCustomer.actions.includes('accept'));
      assert.deepEqual(awaitingCustomer.deliveries.find(row => row.unit === unit), delivery);
      await deliver(winner, order.id, request({ unit, evidence: '该日不能重复提交' }), 409);
      await action('client', otherBoss, order.id, 'accept', request({ unit }), 404);

      const approval = request({ unit });
      const [confirmed, replay] = await Promise.all([accept(order.id, approval), accept(order.id, approval, 201, peer)]);
      assert.deepEqual(replay, confirmed);
      assert.equal(confirmed.status, unit === 3 ? 'completed' : 'claimed');
      assert.ok(Number.isFinite(Date.parse(confirmed.deliveries.find(row => row.unit === unit).acceptedAt)));
      await accept(order.id, request({ unit }), 409);
    }

    const reconciled = await detail('admin', administrator, order.id);
    assert.equal(reconciled.status, 'completed');
    assert.deepEqual(reconciled.deliveries.map(row => row.evidence), ['R1-20', 'R1-21', 'R1-22']);
    assert.deepEqual(reconciled.receipt, published.receipt);
    assert.equal(reconciled.accounting, undefined);
    assert.equal((await detail('employee', winner, order.id)).receipt, undefined);
    const opsOnly = await detail('admin', operations, order.id);
    assert.equal(opsOnly.quote, undefined);
    assert.equal(opsOnly.receipt, undefined);
    assert.deepEqual(opsOnly.deliveries, reconciled.deliveries);
    const adminPage = await list('admin', operations);
    assert.doesNotMatch(JSON.stringify(adminPage), /"[^"]*Cents":/);
    await detail('admin', financeOnly, order.id, 403);
    await seedClub('revoke', administrator.id, 'CLUB_FINANCE_READ');
    assert.equal((await detail('admin', administrator, order.id)).receipt, undefined);
    await financeDetail(order.id, administrator, 403);
    await seedClub('grant', administrator.id, 'CLUB_FINANCE_READ');
    assert.deepEqual((await detail('admin', administrator, order.id)).receipt, published.receipt);

    const pending = await financeDetail(order.id);
    assert.deepEqual(pending.deliveries, reconciled.deliveries);
    assert.deepEqual(cash(pending), ['ready_to_close', 3, 6000, 0, 0, 0, 6000]);
    assert.deepEqual(split(pending), [600, 5100, 300, 6000]);
    const financialOrders = await list('admin', financeOnly, { scope: 'finance' });
    assert.deepEqual(financialOrders.items.find(row => row.id === order.id), pending);
    await financeDetail(order.id, operations, 403);
    await list('admin', operations, { scope: 'finance' }, 403);
    assertCustomerAccounting(await detail('client', boss, order.id), ['ready_to_close', 3, 6000, 0, 0, 0, 6000]);
    const executorAccounting = (await detail('employee', winner, order.id)).accounting;
    assert.deepEqual(executorAccounting, { status: 'ready_to_close', acceptedUnits: 3, rewardCents: 5100 });

    const closeInput = request();
    await action('employee', winner, order.id, 'close', closeInput, 404);
    const before = await balances(winner);
    for (const account of before) assert.deepEqual(orderEntries(account, order.id), []);
    await withdrawal(winner, before[1].balanceCents + 1, 409);
    const closed = await closeTwice(order.id, closeInput);
    assert.deepEqual(cash(closed), ['closed', 3, 6000, 0, 0, 0, 6000]);
    assert.deepEqual(split(closed), [600, 5100, 300, 6000]);
    assert.deepEqual((await financeDetail(order.id)).accounting, closed.accounting);
    assertCustomerAccounting(await detail('client', boss, order.id), ['closed', 3, 6000, 0, 0, 0, 6000]);
    await assertPostings(order.id, winner, before, closeInput, closed.accounting.closedAt, [600, 5100, 300]);
    const available = before[1].balanceCents + 5100;
    await withdrawal(winner, available + 1, 409);
    const withdrawalRequest = await withdrawal(winner, available);
    assert.equal(withdrawalRequest.status, 'pending');
    assert.equal(withdrawalRequest.amountCents, available);
    assert.equal((await personalBalance(winner)).balanceCents, available);
  });

  await t.test('R2 团员代录，老板验收首日后取消，两天后续交付停止', async () => {
    await create('employee', dispatcher, promisedService('缺代录客户'), 400);
    const input = { ...promisedService('暮云'), customerUserId: boss.id };
    const order = await create('employee', dispatcher, input);
    assert.deepEqual(await create('employee', dispatcher, input, 201, peer), order);
    assert.deepEqual([order.source, order.status, order.customerUserId, order.dispatcherUserId],
      ['direct_dispatch', 'pending_dispatch', boss.id, dispatcher.id]);
    assert.equal((await detail('client', boss, order.id)).source, 'direct_dispatch');
    assert.ok(orderIds(await list('employee', dispatcher, { scope: 'dispatch' })).includes(order.id));
    await publishAndClaim(order);

    const report = request({ unit: 1, evidence: 'R2-20' });
    await deliver(runnerA, order.id, report);
    const approval = request({ unit: 1 });
    const accepted = await accept(order.id, approval);
    assert.ok(!(await detail('employee', dispatcher, order.id)).actions.includes('stop'));
    await action('employee', dispatcher, order.id, 'stop', request({ reason: '派单人不能代客户停单' }), 404);
    await action('employee', runnerA, order.id, 'stop', request({ reason: '执行人没有停单权限' }), 404);
    await action('client', otherBoss, order.id, 'stop', request({ reason: '他人的订单' }), 404);
    await action('client', boss, order.id, 'stop', request({ reason: ' ' }), 400);
    const cancellation = request({ reason: '行程变化，取消剩下两日' });
    const stopped = await action('client', boss, order.id, 'stop', cancellation);
    assert.deepEqual(await action('client', boss, order.id, 'stop', cancellation, 201, peer), stopped);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.stop.reason, cancellation.reason);
    assert.ok(Number.isFinite(Date.parse(stopped.stop.stoppedAt)));
    assert.deepEqual(stopped.deliveries, accepted.deliveries);
    await deliver(runnerA, order.id, request({ unit: 2, evidence: 'R2-21' }), 409);
    await accept(order.id, request({ unit: 2 }), 409);
    assert.deepEqual(await accept(order.id, approval, 201, peer), stopped);
    assert.deepEqual((await detail('admin', administrator, order.id)).receipt,
      { amountCents: 6000, occurredAt: new Date(firstPayment.occurredAt).toISOString() });

    const before = await balances(runnerA);
    for (const account of before) assert.deepEqual(orderEntries(account, order.id), []);
    const pending = await financeDetail(order.id);
    assert.deepEqual(cash(pending), ['refund_pending', 1, 6000, 4000, 0, 4000, 6000]);
    const closeInput = request();
    await close(order.id, closeInput, 409);
    const firstRefund = request({ amountCents: 1500, occurredAt: new Date().toISOString(), transferReference: 'R2-退款-1' });
    await action('employee', runnerA, order.id, 'refund', firstRefund, 404);
    await refund(order.id, { ...firstRefund, occurredAt: '2026-11-18T00:00:00.000Z' }, 400);
    await refund(order.id, { ...firstRefund, amountCents: 4001 }, 409);
    const [partial, repeatedRefund] = await Promise.all([refund(order.id, firstRefund), refund(order.id, firstRefund, 201, peer)]);
    assert.deepEqual(repeatedRefund, partial);
    assert.deepEqual(cash(partial), ['refund_pending', 1, 6000, 4000, 1500, 2500, 4500]);
    assert.equal(partial.accounting.refunds.length, 1);
    assertCustomerAccounting(await detail('client', boss, order.id), ['refund_pending', 1, 6000, 4000, 1500, 2500, 4500]);
    await close(order.id, closeInput, 409);
    await refund(order.id, { ...firstRefund, requestId: randomUUID() }, 409);
    const finalRefund = request({ amountCents: 2500, occurredAt: new Date().toISOString(), transferReference: 'R2-退款-2' });
    const refunded = await refund(order.id, finalRefund);
    assert.deepEqual(cash(refunded), ['ready_to_close', 1, 6000, 4000, 4000, 0, 2000]);
    assert.deepEqual(split(refunded), [200, 1700, 100, 2000]);
    assert.deepEqual(await balances(runnerA), before);
    const proof = [firstRefund, finalRefund].map(({ amountCents, occurredAt, transferReference }) => ({ amountCents, occurredAt, transferReference }));
    assert.deepEqual((await financeDetail(order.id)).accounting.refunds, proof);

    const closed = await closeTwice(order.id, closeInput);
    assert.deepEqual(cash(closed), ['closed', 1, 6000, 4000, 4000, 0, 2000]);
    await restartServer();
    assert.deepEqual(await close(order.id, closeInput), closed);
    assert.deepEqual(await refund(order.id, firstRefund), closed);
    assert.deepEqual(await refund(order.id, finalRefund), closed);
    assert.deepEqual((await financeDetail(order.id)).accounting, closed.accounting);
    assert.deepEqual((await financeDetail(order.id)).accounting.refunds, proof);
    assertCustomerAccounting(await detail('client', boss, order.id), ['closed', 1, 6000, 4000, 4000, 0, 2000]);
    await assertPostings(order.id, runnerA, before, closeInput, closed.accounting.closedAt, [200, 1700, 100]);

    const gift = await post('client', boss, '/client/orders', request({
      recipientGameAccount: '用于订单隔离核对的送心号', requestedGiftTimes: 3, dispatcherUserId: dispatcher.id,
    }));
    await read('client', boss, `/client/orders/${order.id}`, 404);
    await detail('client', boss, gift.id, 404);
    assert.ok(!orderIds(await read('client', boss, '/client/orders')).includes(order.id));
    assert.ok(!orderIds(await list('client', boss)).includes(gift.id));

    const first = await list('client', boss, { limit: '1' });
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = await list('client', boss, { limit: '1', after: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.ok(second.items.every(row => row.businessType === businessType && row.customerUserId === boss.id));
    assert.deepEqual(await list('client', otherBoss), { items: [], nextCursor: null });
  });
});
