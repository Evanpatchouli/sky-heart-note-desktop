import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { startClubSystem } from './club-test-system.mjs';

test('本人按次承接和排期独立于其他团员及派单约定', { timeout: 90_000 }, async t => {
  const { db, api, administrator, seedClub, register, restartServer } = await startClubSystem(t, {
    database: 'club_personal_schedule_e2e', adminUsername: 'schedule_admin',
  });
  const dispatcher = await register('schedule_dispatcher', 'employee');
  const first = await register('schedule_first', 'employee');
  const second = await register('schedule_second', 'employee');
  const buyer = await register('schedule_buyer', 'client');
  await seedClub('name', '本人排期测试');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  for (const member of [first, second, administrator]) await seedClub('member', member.id, 'active', 'member');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await api('admin', '/admin/club/commission-rule', {
    method: 'PATCH', token: administrator.token, body: { expectedVersion: 0, basis: 'gift_times', clubFeeCents: 5 },
  });

  const club = '/employee/club';
  const call = (actor, path, method = 'GET', body, status = 200) =>
    api('employee', path, { token: actor.token, method, body, status });
  const order = await api('client', '/client/orders', {
    method: 'POST', token: buyer.token, status: 201, body: {
      requestId: randomUUID(), recipientGameAccount: '本人排期测试订单', requestedGiftTimes: 30, dispatcherUserId: dispatcher.id,
    },
  });
  const route = `${club}/orders/${order.id}`;
  const claimRoute = `${club}/gift-claims/${order.id}`;
  const { quote } = await call(dispatcher, `${route}/pricing`, 'PATCH', {
    expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
    giftSegments: [{ period: 'double', paidGiftTimes: 30, dailyGiftTimes: 3, unitPriceCents: 50 }],
  });
  await call(dispatcher, `${route}/receipts`, 'POST', {
    requestId: randomUUID(), pricingRevision: quote.revision, receivedAmountCents: quote.totalAmountCents,
    receivedAt: '2026-11-24T11:40:00Z',
  }, 201);
  const window = { startDate: '2026-11-20', endDate: '2026-11-29' };
  await call(dispatcher, `${route}/publish`, 'POST', {
    requestId: randomUUID(), pricingRevision: quote.revision, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, ...window, openToClaim: true,
      directed: [{ ...window, userId: first.id, dailyGiftTimes: 1 }] }],
  }, 201);
  const claim = (actor, input) => call(actor, claimRoute, 'POST', {
    requestId: randomUUID(), segmentIndex: 0, ...input,
  }, 201);
  const [offer] = (await call(first, claimRoute)).segments[0].offers;
  const directed = await claim(first, { kind: 'directed', offerId: offer.id });
  const firstPublic = await claim(first, { kind: 'public', dailyGiftTimes: 1 });
  const secondPublic = await claim(second, { kind: 'public', dailyGiftTimes: 1 });
  assert.deepEqual([directed.giftTimes, firstPublic.giftTimes, secondPublic.giftTimes], [10, 10, 10]);

  await call(first, '/employee/songxinhao', 'POST', { name: '只属于第一位团员的送心号' }, 201);
  const [personal] = await call(first, '/employee/songxinhao/linkable');
  const accountRoute = `${route}/shares/${directed.shareId}/execution-accounts`;
  const account = await call(first, accountRoute, 'POST', { personalAccountId: personal.id }, 201);
  const report = await call(first, `${accountRoute}/${account.id}/daily-reports`, 'POST', {
    requestId: randomUUID(), kind: 'daily', businessDate: window.startDate,
    lines: [{ period: 'double', giftTimes: 1, receivedHearts: 2 }],
  }, 201);
  assert.equal(report.receivedHearts, 2);
  const transferred = await call(dispatcher, `${route}/gift-dispatch/reassign`, 'POST', {
    requestId: randomUUID(), shareId: directed.shareId, userId: second.id,
  }, 201);
  assert.equal(transferred.giftTimes, 9);
  const acceptedTransfer = await claim(second, { kind: 'directed', offerId: transferred.id });

  const read = (actor, status = 200) => call(actor, `${route}/assignment`, 'GET', undefined, status);
  const save = (actor, body, status = 200) => call(actor, `${route}/personal-schedule`, 'PATCH', body, status);
  const list = actor => call(actor, `${club}/orders?responsibility=executor&limit=1`);
  const orders = db.collection('club_orders');
  const storedId = new Types.ObjectId(order.id);
  const stored = () => orders.findOne({ _id: storedId });
  const original = await stored();
  const empty = { startDate: null, endDate: null, revision: 0 };
  const initial = await read(first);
  assert.deepEqual(initial.personalSchedule, empty);
  assert.equal(initial.priceUnit, 'gift_times');
  assert.deepEqual(initial.segments[0].shares.map(({ id }) => id), [directed.shareId, firstPublic.shareId]);
  assert.equal(initial.segments[0].shares[0].executionGameAccounts[0].id, account.id);
  assert.deepEqual([
    initial.giftProgress.acceptedGiftTimes, initial.giftProgress.deliveredGiftTimes,
    initial.giftProgress.remainingGiftTimes, initial.giftProgress.actualReceivedHearts,
  ], [11, 1, 10, 2]);
  const other = await read(second);
  assert.deepEqual(other.segments[0].shares.map(({ id }) => id), [secondPublic.shareId, acceptedTransfer.shareId]);
  assert.ok(other.segments[0].shares.every(({ executionGameAccounts }) => executionGameAccounts.length === 0));
  assert.deepEqual([other.giftProgress.acceptedGiftTimes, other.giftProgress.deliveredGiftTimes], [19, 0]);
  assert.equal((await list(dispatcher)).items.length, 0);
  await read(dispatcher, 404);

  const range = { startDate: '2028-02-29', endDate: '2028-03-02', expectedRevision: 0 };
  await save(first, { ...range, startDate: '2027-02-29' }, 400);
  await save(first, { ...range, endDate: null }, 400);
  await save(first, { ...range, endDate: '2028-02-28' }, 400);
  await save(dispatcher, range, 404);
  const [a, b] = await Promise.all([
    save(first, range, [200, 409]), save(first, { ...range, endDate: '2028-03-03' }, [200, 409]),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const winner = a ?? b;
  assert.equal(winner.revision, 1);
  assert.deepEqual(await save(first, { ...range, endDate: winner.endDate }), winner);
  assert.deepEqual((await read(second)).personalSchedule, empty);
  const theirs = await save(second, { ...range, startDate: '2028-03-01' });
  assert.deepEqual((await read(first)).personalSchedule, winner);
  const { items: [listed] } = await list(first);
  assert.deepEqual(listed.personalSchedule, winner);
  assert.deepEqual(listed.giftProgress, initial.giftProgress);
  assert.equal(listed.segments, undefined);

  const cleared = await save(first, { startDate: null, endDate: null, expectedRevision: 1 });
  assert.deepEqual(cleared, { startDate: null, endDate: null, revision: 2 });
  await save(first, range, 409);
  assert.deepEqual((await read(second)).personalSchedule, theirs);
  const afterSchedule = await stored();
  for (const field of ['heartDelivery', 'dispatchPricing', 'giftDispatch', 'fulfillmentRevision', 'receipt', 'updatedAt']) {
    assert.deepEqual(afterSchedule[field], original[field], field);
  }
  await restartServer();
  assert.deepEqual((await read(first)).personalSchedule, cleared);
  assert.deepEqual((await read(second)).personalSchedule, theirs);
  assert.deepEqual((await read(first)).giftProgress, initial.giftProgress);

  await orders.updateOne({ _id: storedId }, { $set: { dispatchWithdrawnAt: new Date() } });
  assert.equal((await read(first)).giftProgress.deliveredGiftTimes, 1);
  assert.equal((await list(first)).items[0].id, order.id);
  await read(second, 404);
  assert.equal((await list(second)).items.length, 0);
  await save(second, { ...range, expectedRevision: 1 }, 404);

  await seedClub('member', first.id, 'inactive', 'member');
  await read(first, 403);
  await save(first, { ...range, expectedRevision: 2 }, 403);
});
