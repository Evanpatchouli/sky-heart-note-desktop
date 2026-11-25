import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { startClubSystem } from './club-test-system.mjs';

test(
  '历史按颗订单保留监督、待核报告和老板原计量',
  { timeout: 120000 },
  async (t) => {
    const { db, api, administrator, register, seedClub } =
      await startClubSystem(t, {
        database: 'club_fulfillment_e2e',
        adminUsername: 'fulfillment_admin',
      });
    const first = await register('fulfillment_first', 'employee');
    const second = await register('fulfillment_second', 'employee');
    const owner = await register('fulfillment_owner', 'client');
    const other = await register('fulfillment_other', 'client');
    await seedClub('name', '送心俱乐部');
    for (const actor of [administrator, first, second]) {
      await seedClub('member', actor.id, 'active', 'dispatcher');
    }
    await db
      .collection('users')
      .updateMany(
        { _id: { $in: [first.id, second.id] } },
        { $set: { nickname: '同名团员' } },
      );

    const call = (
      actor,
      path,
      method = 'GET',
      body,
      status = method === 'POST' ? 201 : 200,
      app = 'employee',
    ) => api(app, path, { token: actor.token, method, body, status });
    const ordersRoute = '/employee/club/orders';
    const clientRoute = '/client/orders';
    const readCustomer = (actor, path, status = 200) =>
      call(actor, path, 'GET', undefined, status, 'client');
    const regular = { period: 'normal', hearts: 4, unitPriceCents: 50 };
    const double = { period: 'double', hearts: 4, unitPriceCents: 35 };
    async function prepare(
      customer,
      dispatcher,
      recipientGameAccount,
      segments,
    ) {
      const requestedHearts = segments.reduce(
        (sum, segment) => sum + segment.hearts,
        0,
      );
      const orders = db.collection('club_orders');
      const _id = new mongoose.Types.ObjectId();
      const id = _id.toHexString();
      const path = `${ordersRoute}/${id}`;
      const pricing = {
        revision: 1,
        basis: 'received_hearts',
        dispatchFeeCents: 5,
        segments,
      };
      // The current creation API takes gift times. Seed the old persisted shape.
      await orders.insertOne({
        _id, clubId: 'club', source: 'client_order', businessType: 'heart_delivery',
        createdByUserId: customer.id, customerUserId: customer.id, customerLinkStatus: 'verified',
        requestId: randomUUID(), recipientGameAccount, dispatcherUserId: dispatcher.id,
        dispatcherAssignment: 'customer_selected', dispatchStatus: 'pending',
        heartDelivery: { requestedHearts }, pricing, shares: [], createdAt: new Date(),
      });
      const publish = async () => {
        const receivedAmountCents = segments.reduce((sum, segment) => sum + segment.hearts * segment.unitPriceCents, 0);
        const publishedAt = new Date('2026-11-04T11:40:00Z');
        await orders.updateOne({ _id }, {
          $set: {
            dispatchStatus: 'published', publishedAt,
            dispatchPricing: { ...pricing, version: 1, clubFeeCents: 5 },
            allocation: { requestId: randomUUID(), publicHearts: requestedHearts, publicRemainingHearts: requestedHearts, directed: [] },
            receipt: {
              requestId: randomUUID(), pricingRevision: 1, receivedAt: publishedAt, recordedAt: publishedAt,
              receivedAmountCents, recordedByUserId: dispatcher.id, receivedByUserId: dispatcher.id,
              quote: { revision: 1, segments, heartsAmountCents: receivedAmountCents,
                totalAmountCents: receivedAmountCents },
            },
          },
          $unset: { pricing: '' },
        });
      };
      return { id, path, publish };
    }

    const a = await prepare(owner, first, '云海的游戏账号', [regular, double]);
    const b = await prepare(other, second, '星月的游戏账号', [regular]);
    const cpath = (order) => `${clientRoute}/${order.id}`;
    assert.deepEqual((await readCustomer(owner, cpath(a))).deliveryProgress, {
      agreedDeadline: null,
      observedHearts: 0,
      creditedHearts: 0,
      remainingHearts: 8,
    });
    const deadline = { businessDate: '2026-11-10' };
    await call(second, `${a.path}/agreed-deadline`, 'PATCH', deadline, 404);
    await call(
      first,
      `${a.path}/agreed-deadline`,
      'PATCH',
      { businessDate: '2026-02-30' },
      400,
    );
    const deadlineAttempts = await Promise.all(
      [first, first].map((actor) =>
        call(actor, `${a.path}/agreed-deadline`, 'PATCH', deadline),
      ),
    );
    assert.deepEqual(deadlineAttempts, [
      { agreedDeadline: '2026-11-10' },
      { agreedDeadline: '2026-11-10' },
    ]);
    await call(
      first,
      `${a.path}/agreed-deadline`,
      'PATCH',
      { businessDate: '2026-11-11' },
      409,
    );
    assert.equal(
      (await readCustomer(owner, cpath(a))).deliveryProgress.agreedDeadline,
      deadline.businessDate,
    );
    await a.publish();
    await b.publish();

    async function claim(actor, order, hearts) {
      return call(
        actor,
        `/employee/club/claim-board/${order.id}/claims`,
        'POST',
        { requestId: randomUUID(), kind: 'public', hearts },
      );
    }

    async function link(actor, order, shareId, name) {
      await call(actor, '/employee/songxinhao', 'POST', { name });
      const accounts = await call(actor, '/employee/songxinhao/linkable');
      const path = `${order.path}/shares/${shareId}/execution-accounts`;
      const account = await call(actor, path, 'POST', {
        personalAccountId: accounts.find((item) => item.name === name).id,
      });
      return `${path}/${account.id}/daily-reports`;
    }

    const mainShare = await claim(second, a, 4);
    const unscheduled = await claim(second, a, 3);
    const otherShare = await claim(first, b, 4);
    const reportPath = await link(second, a, mainShare.id, '送心号仅本人可见');
    const otherReportPath = await link(
      first,
      b,
      otherShare.id,
      '另一单的游戏号',
    );
    const schedules = `${a.path}/shares/${mainShare.id}/agreed-report-dates`;
    const businessDates = [7, 8, 9, 10, 11].map(
      (day) => `2026-11-${String(day).padStart(2, '0')}`,
    );
    await call(second, schedules, 'PATCH', { businessDates }, 404);
    await call(
      first,
      schedules.replace(mainShare.id, otherShare.id),
      'PATCH',
      { businessDates },
      404,
    );
    await call(
      first,
      schedules,
      'PATCH',
      { businessDates: [...businessDates, businessDates[0]] },
      400,
    );
    await call(
      first,
      schedules,
      'PATCH',
      { businessDates: ['2026-11-31'] },
      400,
    );
    assert.deepEqual(
      await call(first, schedules, 'PATCH', {
        businessDates: businessDates.toReversed(),
      }),
      { agreedReportDates: businessDates },
    );
    assert.deepEqual(await call(first, schedules, 'PATCH', { businessDates }), {
      agreedReportDates: businessDates,
    });
    await call(
      first,
      schedules,
      'PATCH',
      { businessDates: businessDates.slice(1) },
      409,
    );

    const report = (actor, path, businessDate, line, reason) =>
      call(actor, path, 'POST', {
        requestId: randomUUID(),
        businessDate,
        lines: [line],
        kind: reason ? 'supplement' : 'daily',
        reason,
      });
    const regularLine = {
      period: 'normal',
      quoteSegment: 1,
      giftTimes: 1,
      receivedHearts: 1,
    };
    const doubleLine = {
      period: 'double',
      quoteSegment: 2,
      giftTimes: 1,
      receivedHearts: 2,
    };
    const original = await report(
      second,
      reportPath,
      businessDates[0],
      doubleLine,
    );
    await call(
      second,
      `${a.path}/daily-reports/${original.id}/corrections`,
      'POST',
      {
        requestId: randomUUID(),
        expectedVersion: 1,
        reason: '排查首次到账',
        lines: [{ ...doubleLine, giftTimes: 0, receivedHearts: 0 }],
      },
    );
    await report(second, reportPath, businessDates[1], {
      ...regularLine,
      giftTimes: 0,
      receivedHearts: 0,
    });
    await report(
      second,
      reportPath,
      businessDates[3],
      regularLine,
      '补报旧业务日',
    );
    await report(second, reportPath, businessDates[4], doubleLine);
    await report(second, reportPath, '2026-11-12', doubleLine);
    await report(first, otherReportPath, businessDates[0], regularLine);

    const through = businessDates[3];
    const fulfillment = `${a.path}/fulfillment?through=${through}`;
    const queue = (date) =>
      `${ordersRoute}/fulfillment-exceptions?through=${date}`;
    await call(
      first,
      `${a.path}/fulfillment?through=2026-11-32`,
      'GET',
      undefined,
      400,
    );
    await call(
      first,
      `${ordersRoute}/fulfillment-exceptions`,
      'GET',
      undefined,
      400,
    );
    await call(second, fulfillment, 'GET', undefined, 404);
    await call(
      first,
      fulfillment.replace('/employee/club/', '/employee/clubs/side/'),
      'GET',
      undefined,
      404,
    );
    await call(owner, fulfillment, 'GET', undefined, 403, 'client');
    assert.deepEqual((await call(second, queue(through))).items, []);
    assert.deepEqual((await call(first, queue('2026-11-06'))).items, []);

    const status = await call(first, fulfillment);
    assert.equal(status.overdue, true);
    assert.equal(status.observedHearts, 2);
    assert.equal(status.remainingHearts, 6);
    assert.equal(status.unclaimedHearts, 1);
    const [timed, withoutDates] = status.shares;
    assert.equal(timed.nickname, '同名团员');
    assert.equal(timed.userId, second.id);
    assert.equal(timed.id, mainShare.id);
    assert.equal(timed.overdue, true);
    assert.equal(timed.remainingHearts, 2);
    assert.deepEqual(
      timed.days.map((day) => [
        day.date,
        day.status,
        day.reportedAccounts,
        day.observedHearts,
      ]),
      [
        [businessDates[0], 'recorded', 1, 2],
        [businessDates[1], 'recorded', 1, 0],
        [businessDates[2], 'missing', 0, 0],
        [businessDates[3], 'pending_review', 0, 0],
        [businessDates[4], 'not_due', 0, 0],
      ],
    );
    assert.equal(timed.days[0].correctionPending, true);
    assert.equal(timed.days[3].supplementPending, true);
    assert.equal(withoutDates.id, unscheduled.id);
    assert.deepEqual(withoutDates.days, []);
    assert.equal(
      (await call(second, `${b.path}/fulfillment?through=${through}`)).overdue,
      false,
    );
    const [exception] = (await call(first, queue(through))).items;
    assert.equal(exception.order.id, a.id);
    assert.deepEqual(
      exception.fulfillment.shares.map((share) => share.id),
      [mainShare.id, unscheduled.id],
    );
    assert.deepEqual(
      exception.fulfillment.shares[0].days.map((day) => day.date),
      [businessDates[0], businessDates[2], businessDates[3]],
    );
    const later = await call(
      first,
      `${a.path}/fulfillment?through=${businessDates[4]}`,
    );
    assert.equal(later.shares[0].remainingHearts, 0);
    assert.equal(later.shares[0].overdue, false);

    const customerA = await readCustomer(owner, cpath(a));
    assert.deepEqual(customerA.deliveryProgress, {
      agreedDeadline: '2026-11-10',
      observedHearts: 6,
      creditedHearts: 4,
      remainingHearts: 4,
    });
    assert.deepEqual(customerA.quote.segments, [regular, double]);
    const customerB = await readCustomer(other, cpath(b));
    assert.deepEqual(customerB.deliveryProgress, {
      agreedDeadline: null,
      observedHearts: 1,
      creditedHearts: 1,
      remainingHearts: 3,
    });
    assert.doesNotMatch(
      JSON.stringify(customerA),
      /clubFee|dispatchFee|receivedBy|recordedBy|shares|approval|actualUnlock|fulfillment|送心号仅本人可见|星月/,
    );
    assert.ok(!JSON.stringify(customerA).includes(`"${second.id}"`));
    assert.deepEqual((await readCustomer(owner, '/client/orders')).items, [
      customerA,
    ]);
    assert.deepEqual((await readCustomer(other, '/client/orders')).items, [
      customerB,
    ]);
    await readCustomer(other, cpath(a), 404);
    await readCustomer(owner, cpath(b), 404);
  },
);
