import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startSystem, captchaCode } from './start-system.mjs';

const gift = (paidGiftTimes, unitPriceCents = 50, period = 'normal', promotionalGiftTimes = 0) =>
  ({ period, paidGiftTimes, dailyGiftTimes: paidGiftTimes, unitPriceCents, ...(promotionalGiftTimes ? { promotionalGiftTimes } : {}) });
const receivedAt = '2026-11-19T10:00:00.000Z';
const days = ['2026-11-20', '2026-11-21', '2026-11-22'];
const stopInput = () => ({ requestId: randomUUID(), confirmed: true });

test('按次停送、锁价退款和优惠券返还', { timeout: 160_000 }, async t => {
  const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.termination.test`]));
  const { base, password, seedClub, startPeer, restartServer, db } = await startSystem(t, {
    database: 'gift_termination_e2e', adminUsername: 'gift_termination_admin', origins,
  });
  const challenges = new Map();
  async function call(app, path, actor, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200, server = base) {
    const headers = { origin: origins[app] };
    if (actor) headers.authorization = `Bearer ${actor.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (path.startsWith('/user/') && challenges.has(app)) headers.cookie = challenges.get(app);
    const response = await fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.ok([status].flat().includes(response.status), `${method} ${path} ${response.status} ${JSON.stringify(result)}`);
    if (path.startsWith('/captcha/')) challenges.set(app, response.headers.getSetCookie()
      .find(item => item.startsWith('sky_captcha_')).split(';')[0]);
    return result.data;
  }
  async function login(app, username) {
    await call(app, `/captcha/login?app=${app}`);
    return call(app, '/user/login?type=account', null, { app, username, password, captcha: captchaCode });
  }
  async function register(username) {
    await call('client', '/captcha/register?app=client');
    await call('client', '/user/register?type=account', null, { app: 'client', username, password, captcha: captchaCode });
    return login('client', username);
  }
  const manager = await login('admin', 'gift_termination_admin');
  const dispatcher = await login('employee', 'gift_termination_admin');
  const owner = await register('gift_termination_customer');
  const stranger = await register('gift_termination_stranger');
  await seedClub('name', '按次退款测试');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('grant', dispatcher.id, 'CLUB_COMMISSION_MANAGE');
  await seedClub('grant', manager.id, 'CLUB_FINANCE_READ');
  await call('admin', '/admin/club/commission-rule', manager, { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  const e = (path, body, method, status, server) => call('employee', path, dispatcher, body, method, status, server);
  const c = (path, body, status, actor = owner) => call('client', path, actor, body, undefined, status);
  const actorPath = '/employee/club';
  const { invitationUrl } = await e(actorPath + '/member-invitations', {});
  const invitationToken = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('token');
  await call('client', '/client/club-invitations/register', null, { token: invitationToken, username: 'gift_other_employee', password });
  const otherEmployee = await login('employee', 'gift_other_employee');
  await e('/employee/songxinhao', { name: '按次退款执行号' });
  const [account] = await e('/employee/songxinhao/linkable');
  const peer = await startPeer();

  const coupon = async () => (await call('admin', '/admin/club/promotions/coupons', manager, {
    requestId: randomUUID(), customerUserId: owner.id, name: '满五十减五',
    kind: 'threshold_coupon', thresholdCents: 5000, discountCents: 500,
  })).couponId;
  const available = async id => ((await c('/client/club/order-options')).coupons ?? []).some(item => item.couponId === id);
  const publishRequest = () => ({ requestId: randomUUID(), ruleVersion: 1, pricingRevision: 1, commissionReviewRevision: 0 });
  async function booked({ label = '测试订单', segments = [gift(100)], personalDiscountCents, platformCouponId, publish = true,
    offline = false, received } = {}) {
    const order = await e('/employee/club/orders', {
      requestId: randomUUID(), recipientGameAccount: label, requestedGiftTimes: segments.reduce((n, part) => n + part.paidGiftTimes, 0),
      ...(offline ? {} : { existingCustomerUserId: owner.id }),
    });
    const path = '/employee/club/orders/' + order.id;
    const client = '/client/orders/' + order.id;
    const { quote } = await e(path + '/pricing', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5, giftSegments: segments,
      ...(personalDiscountCents === undefined ? {} : { personalDiscountCents }),
      ...(platformCouponId ? { platformCouponId } : {}),
    }, 'PATCH');
    await e(path + '/receipts', { requestId: randomUUID(), pricingRevision: 1,
      receivedAmountCents: received ?? quote.totalAmountCents, receivedAt });
    if (publish) {
      const all = [...segments, ...segments.filter(part => part.promotionalGiftTimes)];
      await e(path + '/publish', { ...publishRequest(),
        giftDispatchSegments: all.map((_, segmentIndex) => ({
          segmentIndex, startDate: days[segmentIndex], endDate: days[segmentIndex], openToClaim: true, directed: [],
        })),
      });
    }
    return { ...order, path, client, quote };
  }
  const claim = (order, segmentIndex, dailyGiftTimes, status, requestId = randomUUID()) =>
    e('/employee/club/gift-claims/' + order.id, { requestId, segmentIndex, kind: 'public', dailyGiftTimes }, 'POST', status);
  async function report(order, times, { segmentIndex = 0, capacity = 100, receivedHearts = times } = {}) {
    const claimId = randomUUID();
    const receipt = await claim(order, segmentIndex, capacity, undefined, claimId);
    const { shareId } = receipt;
    const accountPath = `${order.path}/shares/${shareId}/execution-accounts`;
    const linked = await e(accountPath, { personalAccountId: account.id });
    const path = `${accountPath}/${linked.id}/daily-reports`;
    const body = { requestId: randomUUID(), kind: 'daily', businessDate: days[segmentIndex], lines: [{ giftTimes: times, receivedHearts }] };
    return { path, body, claimId, receipt, report: await e(path, body) };
  }
  const correct = (order, original, giftTimes, receivedHearts = giftTimes) =>
    e(`${order.path}/daily-reports/${original.report.originalId}/corrections`, {
      requestId: randomUUID(), expectedVersion: 1, reason: '按历史凭据更正赠送时点', lines: [{ giftTimes, receivedHearts }],
    });
  const stop = (order, body = stopInput(), status, actor) => c(order.client + '/termination', body, status, actor);
  const dispatcherView = async order => (await e(order.path + '/fulfillment')).termination;
  const ownerView = async order => (await c(order.client)).deliveryProgress.termination;
  const change = (order, revision, fields = {}, status) => e(order.path + '/termination/changes', {
    requestId: randomUUID(), expectedRevision: revision, reason: '已与老板核对实际送心记录', ...fields,
  }, 'POST', status);
  const refundInput = (view, amountCents, occurredAt = '2026-11-22T09:00:00.000Z') =>
    ({ ...stopInput(), terminationId: view.id, expectedRevision: view.revision, amountCents, occurredAt });
  const refund = (order, input, status, server) => e(order.path + '/termination/refunds', input, 'POST', status, server);

  await t.test('老板与派单人独立办理，保留原日报、核对现金、并发及重试只记一次', async () => {
    const order = await booked();
    const wrongOrder = await booked({ publish: false });
    const recorded = await report(order, 80);
    const input = stopInput();
    await stop(order, input, 404, stranger);
    await stop(order, { ...input, confirmed: false }, 400);
    const stopped = await stop(order, input);
    assert.deepEqual(await stop(order, input), stopped);
    await stop(order, { ...input, reason: '重复标识' }, 409);
    await stop(order, stopInput(), 409);
    assert.deepEqual([stopped.deliveredGiftTimes, stopped.stoppedPaidGiftTimes, stopped.fulfilledServiceCents,
      stopped.refundDueCents, stopped.refundedCents, stopped.netReceivedCents], [80, 20, 4000, 1000, 0, 5000]);
    await claim(order, 0, 1, 404);
    assert.deepEqual(await claim(order, 0, 100, 201, recorded.claimId), recorded.receipt);
    await claim(order, 0, 99, 409, recorded.claimId);
    assert.ok(!(await e('/employee/club/orders/fulfillment-exceptions?through=2026-11-23')).items
      .some(item => item.order.id === order.id));
    assert.deepEqual(await e(recorded.path, recorded.body), recorded.report);
    await e(recorded.path, { ...recorded.body, requestId: randomUUID() }, 'POST', 409);
    await refund(order, refundInput(stopped, 100), 409);
    await change(order, stopped.revision, { reason: ' ' }, 400);
    const changed = await change(order, stopped.revision);
    await call('employee', order.path + '/termination/refunds', otherEmployee, refundInput(changed, 100), 'POST', 404);
    await call('employee', order.path + '/termination/changes', otherEmployee, {
      requestId: randomUUID(), expectedRevision: changed.revision, reason: '其他团员不能登记',
    }, 'POST', 404);
    await refund(wrongOrder, refundInput(changed, 100), 404);
    const payment = refundInput(changed, 600);
    const results = await Promise.all([
      refund(order, payment, [201, 409]), refund(order, refundInput(changed, 600), [201, 409], peer),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const first = results.find(Boolean);
    const winner = first.refunds[0];
    const retry = { ...payment, requestId: winner.requestId };
    assert.deepEqual(await refund(order, retry), first);
    const updated = await dispatcherView(order);
    await refund(order, { ...retry, amountCents: 500 }, 409);
    await refund(order, { ...refundInput(updated, 600), requestId: randomUUID() }, 409);
    await refund(order, refundInput(updated, 401), 409);
    const final = await refund(order, refundInput(updated, 400, '2026-11-22T09:01:00.000Z'));
    assert.deepEqual([final.refundedCents, final.refundRemainingCents, final.netReceivedCents], [1000, 0, 4000]);
    assert.ok(final.refunds.every(row => row.recordedByUserId === dispatcher.id && row.refundDueAtRecordingCents === 1000));
    await restartServer();
    assert.deepEqual(await dispatcherView(order), final);
    const read = await ownerView(order);
    assert.deepEqual(read.refunds.map(item => Object.keys(item).sort()), [['amountCents', 'occurredAt'], ['amountCents', 'occurredAt']]);
    assert.deepEqual(Object.keys(read.change), ['reason']);
    await correct(order, recorded, 85);
    const corrected = await dispatcherView(order);
    assert.deepEqual([corrected.fulfilledServiceCents, corrected.refundDueCents, corrected.refundedCents, corrected.excessRefundCents],
      [4250, 750, 1000, 250]);
    assert.deepEqual(corrected.refunds, final.refunds);
    const supplement = { ...recorded.body, requestId: randomUUID(), businessDate: days[1],
      kind: 'supplement', reason: '补报停送前实际赠送', lines: [{ giftTimes: 2, receivedHearts: null }] };
    await e(recorded.path, supplement);
    const latest = await dispatcherView(order);
    assert.deepEqual([latest.deliveredGiftTimes, latest.refundDueCents, latest.excessRefundCents], [87, 650, 350]);
  });

  await t.test('买赠、个人让利、尾差和折后现金沿用确认报价', async () => {
    for (const [times, personalDiscountCents, promotionalGiftTimes, expected, fulfilled] of [
      [80, 500, 0, 900, 3600], [90, 500, 0, 450, 4050], [95, 500, 0, 225, 4275],
      [80, 500, 5, 900, 3600], [90, 500, 5, 450, 4050], [95, 500, 5, 225, 4275],
      [80, undefined, 5, 1000, 4000],
    ]) {
      const order = await booked({ segments: [gift(100, 50, 'normal', promotionalGiftTimes)], personalDiscountCents });
      await report(order, times);
      let view = await stop(order);
      assert.deepEqual([view.refundDueCents, view.fulfilledServiceCents, view.stoppedPromotionalGiftTimes],
        [expected, fulfilled, promotionalGiftTimes]);
      if (times === 90) {
        assert.equal(view.fulfilledPersonalDiscountCents, 450);
        view = await change(order, view.revision);
        assert.equal((await refund(order, refundInput(view, 450))).netReceivedCents, 4050);
      }
    }
    const giftsOnly = await booked({ segments: [gift(100, 50, 'normal', 5)] });
    await report(giftsOnly, 100);
    await report(giftsOnly, 2, { segmentIndex: 1, capacity: 5 });
    const gifted = await stop(giftsOnly);
    assert.deepEqual([gifted.stoppedPaidGiftTimes, gifted.stoppedPromotionalGiftTimes, gifted.refundDueCents], [0, 3, 0]);
    const differentPrices = await booked({ segments: [gift(2, 51), gift(1, 80, 'double')], personalDiscountCents: 3 });
    await report(differentPrices, 1, { capacity: 2 });
    const priced = await stop(differentPrices);
    assert.equal(priced.fulfilledServiceCents + priced.refundDueCents, differentPrices.quote.totalAmountCents);
    assert.equal(priced.fulfilledServiceCents, 50);
  });

  await t.test('优惠券按最新赠送次数处理，停送后禁止发布', async () => {
    const unusedId = await coupon();
    const beforePublish = await booked({ platformCouponId: unusedId, publish: false });
    assert.equal(await available(unusedId), false);
    assert.equal((await c(beforePublish.client)).deliveryProgress.canRequestTermination, true);
    const stopped = await stop(beforePublish);
    assert.deepEqual([stopped.stoppedPaidGiftTimes, stopped.refundDueCents, stopped.couponStatus], [100, 4500, 'returned']);
    assert.equal(await available(unusedId), true);
    await e(beforePublish.path + '/publish', publishRequest(), 'POST', 409);
    const newOrder = await booked({ platformCouponId: unusedId, publish: false });
    assert.equal(await available(unusedId), false);
    assert.equal((await ownerView(beforePublish)).couponStatus, 'returned');
    assert.equal(newOrder.quote.totalAmountCents, 4500);

    const appliedId = await coupon();
    const applied = await booked({ platformCouponId: appliedId });
    await report(applied, 90);
    const kept = await stop(applied);
    assert.deepEqual([kept.refundDueCents, kept.fulfilledPlatformDiscountCents, kept.couponStatus], [450, 450, 'used']);
    assert.equal(await available(appliedId), false);

    const unknownId = await coupon();
    const unknown = await booked({ platformCouponId: unknownId });
    const two = await report(unknown, 2, { receivedHearts: null });
    assert.equal((await stop(unknown)).couponStatus, 'used');
    assert.equal(await available(unknownId), false);
    await correct(unknown, two, 0, null);
    const corrected = await ownerView(unknown);
    assert.equal(corrected.couponStatus, 'returned');
    assert.equal(corrected.refundDueCents, 4500);
    assert.equal(await available(unknownId), true);

    const underpaid = await booked({ received: 100, publish: false });
    assert.equal((await c(underpaid.client)).deliveryProgress.canRequestTermination, false);
    await stop(underpaid, stopInput(), 409);
  });

  await t.test('缺老板绑定时可线下登记，已结单不能改原现金记录', async () => {
    const order = await booked({ offline: true });
    await stop(order, stopInput(), 404);
    await change(order, 0, {}, 409);
    const changed = await change(order, 0, { customerRequestReference: '老板在线下提供的退款登记编号' });
    assert.equal(changed.origin, 'reported_customer_request');
    assert.equal(changed.refundDueCents, 5000);
    await db.collection('club_orders').updateOne({ 'giftTermination.id': changed.id }, { $set: { closedAt: new Date() } });
    await refund(order, refundInput(changed, 5000), 409);
  });

  await t.test('跨期拒补按原成交退款，两个入口共用一笔实退', async () => {
    const order = await booked();
    await report(order, 95);
    const shift = { quoteSegment: 1, giftTimes: 5, targetPeriod: 'double', targetUnitPriceCents: 60 };
    const preview = await e(order.path + '/fulfillment/price-preview', shift);
    const proposal = await e(order.path + '/price-adjustment', {
      ...shift, expectedVersion: preview.adjustmentReview.version, reason: '跨期约定剩余次数每次加价', requestId: randomUUID(),
    });
    const refusal = await c(order.client + '/price-adjustment/decision', {
      requestId: randomUUID(), adjustmentId: proposal.id, expectedRevision: proposal.revision, decision: 'decline',
    });
    assert.equal('requestId' in refusal, false);
    assert.deepEqual(Object.keys(refusal.decision).sort(), ['decidedAt', 'source', 'value']);
    const view = await dispatcherView(order);
    assert.deepEqual([view.id, view.origin, view.refundDueCents, view.supplementReceivedCents], [refusal.id, 'declined_adjustment', 250, 0]);
    const financeSettlement = () => call('admin', `/admin/club/orders/${order.id}/settlement`, manager);
    const pending = await financeSettlement();
    assert.equal(pending.status, 'review_required');
    assert.deepEqual([pending.cash.originalReceivedCents, pending.cash.supplementReceivedCents,
      pending.cash.refundDueCents, pending.cash.refundedCents, pending.cash.refundRemainingCents, pending.cash.netReceivedCents],
    [5000, 0, 250, 0, 250, 5000]);
    const payment = refundInput(view, 250);
    const legacy = { adjustmentId: payment.terminationId, expectedRevision: payment.expectedRevision,
      kind: 'refund', requestId: payment.requestId, amountCents: payment.amountCents, occurredAt: payment.occurredAt };
    await Promise.all([refund(order, payment), e(order.path + '/price-adjustment/payments', legacy)]);
    const settled = await ownerView(order);
    assert.deepEqual([settled.refundedCents, settled.netReceivedCents, settled.supplementReceivedCents, settled.refunds.length], [250, 4750, 0, 1]);
    const refunded = await financeSettlement();
    assert.equal(refunded.status, 'ready_to_close');
    assert.deepEqual([refunded.deliveredGiftTimes, refunded.cash.originalReceivedCents, refunded.cash.supplementReceivedCents,
      refunded.cash.refundDueCents, refunded.cash.refundedCents, refunded.cash.refundRemainingCents,
      refunded.cash.netReceivedCents, refunded.totals.allocatedCents], [95, 5000, 0, 250, 250, 0, 4750, 4750]);
    assert.deepEqual(refunded.termination.refunds.map(row => [row.requestId, row.recordedByUserId, row.amountCents]),
      [[payment.requestId, dispatcher.id, 250]]);
    const amended = (await c(order.client)).deliveryProgress.priceAdjustment;
    assert.deepEqual(Object.keys(amended.payments[0]).sort(), ['amountCents', 'kind', 'occurredAt']);
  });
});
