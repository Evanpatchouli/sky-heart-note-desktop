import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startClubSystem } from './club-test-system.mjs';

const employee = '/employee/club';
const client = '/client/orders';
const day = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const publicWindow = (segmentIndex, date) => ({
  segmentIndex, startDate: date, endDate: date, openToClaim: true, directed: [],
});
const action = (adjustment) => ({
  adjustmentId: adjustment.id, expectedRevision: adjustment.revision, requestId: randomUUID(),
});
const payment = (adjustment, kind, amountCents) => ({
  ...action(adjustment), kind, amountCents, occurredAt: new Date().toISOString(),
});
const report = (businessDate, quoteSegment, giftTimes, receivedHearts, period) => ({
  requestId: randomUUID(), kind: 'daily', businessDate,
  lines: [{ quoteSegment, giftTimes, receivedHearts, period }],
});

test('按次改价跨 API 实例和进程重启保留协商、收退凭据、独立续段与多轮计价', { timeout: 190000 }, async (t) => {
  const { api, administrator, seedClub, register, restartServer, startPeer } = await startClubSystem(t, {
    database: 'club_price_adjustment_e2e',
    adminUsername: 'price_adjustment_admin',
  });
  const dispatcher = await register('adjustment_host', 'employee');
  const worker = await register('adjustment_worker', 'employee');
  const partner = await register('adjustment_partner', 'employee');
  const owner = await register('adjustment_customer', 'client');
  const other = await register('adjustment_other_customer', 'client');
  const call = (actor, path, method = 'GET', body, status = method === 'POST' ? 201 : 200, server) =>
    api(path.split('/')[1], path, { token: actor.token, method, body, status, server });
  await seedClub('name', '跨期核对');
  await seedClub('member', administrator.id, 'active', 'member');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('member', worker.id, 'active', 'member');
  await seedClub('member', partner.id, 'active', 'member');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await call(administrator, '/admin/club/commission-rule', 'PATCH', {
    expectedVersion: 0, clubFeeCents: 5,
  });

  const personalAccounts = new Map();
  for (const actor of [worker, partner]) {
    await call(actor, '/employee/songxinhao', 'POST', { name: '本人送心号' });
    personalAccounts.set(actor.id, (await call(actor, '/employee/songxinhao/linkable'))[0].id);
  }
  const peer = await startPeer();

  async function publish(source, giftTimes, businessDate) {
    const direct = source === 'direct_dispatch';
    const order = await call(direct ? dispatcher : owner, direct ? employee + '/orders' : client, 'POST', {
      requestId: randomUUID(), recipientGameAccount: `${source} 游戏号`, requestedGiftTimes: giftTimes,
      deliveryPeriodPreference: 'double',
      ...(direct ? { existingCustomerUserId: owner.id } : { dispatcherUserId: dispatcher.id }),
    });
    const path = `${employee}/orders/${order.id}`;
    const { quote } = await call(dispatcher, path + '/pricing', 'PATCH', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
      giftSegments: [{ period: 'double', paidGiftTimes: giftTimes, dailyGiftTimes: giftTimes, unitPriceCents: 50 }],
    });
    await call(dispatcher, path + '/receipts', 'POST', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: quote.totalAmountCents,
      receivedAt: day(10) + 'T10:00:00+08:00',
    });
    await call(dispatcher, path + '/publish', 'POST', {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: [publicWindow(0, businessDate)],
    });
    return {
      path, claims: `${employee}/gift-claims/${order.id}`,
      amendments: path + '/price-adjustment', customer: `${client}/${order.id}`,
    };
  }

  async function claim(order, actor, segmentIndex, dailyGiftTimes) {
    const { shareId } = await call(actor, order.claims, 'POST', {
      requestId: randomUUID(), segmentIndex, kind: 'public', dailyGiftTimes,
    });
    const account = await call(actor, `${order.path}/shares/${shareId}/execution-accounts`, 'POST', {
      personalAccountId: personalAccounts.get(actor.id),
    });
    return { shareId, accountId: account.id };
  }
  const diary = (order, actor, { shareId, accountId }, body, status) =>
    call(actor, `${order.path}/shares/${shareId}/execution-accounts/${accountId}/daily-reports`, 'POST', body, status);
  const details = (order, server) => call(owner, order.customer, 'GET', undefined, 200, server);
  const supervision = (order) => call(dispatcher, order.path + '/fulfillment');
  const propose = (order, fields, status, actor = dispatcher) => call(actor, order.amendments, 'POST', fields, status);
  const decide = (order, fields, status, actor = owner, server) =>
    call(actor, order.customer + '/price-adjustment/decision', 'POST', fields, status, server);
  const pay = (order, fields, status, actor = dispatcher, server) =>
    call(actor, order.amendments + '/payments', 'POST', fields, status, server);

  async function proposal(order, shift) {
    const preview = await call(dispatcher, order.path + '/fulfillment/price-preview', 'POST', shift);
    assert.ok(preview.adjustmentReview.version);
    return {
      preview,
      input: { ...shift, expectedVersion: preview.adjustmentReview.version, requestId: randomUUID(), reason: '余量按新约定履约' },
    };
  }

  async function extend(order, giftTimes, unitPriceCents, businessDate) {
    const continuation = randomUUID();
    const segment = { period: 'normal', paidGiftTimes: giftTimes, dailyGiftTimes: giftTimes, unitPriceCents };
    const window = { startDate: businessDate, endDate: businessDate };
    const path = '/continuation-quotes/' + continuation;
    await call(dispatcher, order.path + '/continuation-quotes', 'POST', { requestId: continuation, segment, window });
    await call(owner, order.customer + path + '/acceptance', 'POST', { requestId: randomUUID() });
    return call(dispatcher, order.path + path + '/receipt', 'POST', {
      requestId: randomUUID(), receivedAmountCents: giftTimes * unitPriceCents, receivedAt: day(5) + 'T10:00:00+08:00',
    });
  }

  await t.test('同意与实补可跨实例重试，独立续段和第二轮改价保留适用段及首次收款', async () => {
    const order = await publish('client_order', 8, day(6));
    const original = await claim(order, worker, 0, 8);
    const firstReport = report(day(6), 1, 3, 6, 'double');
    const firstFact = await diary(order, worker, original, firstReport);
    const { input, preview } = await proposal(order, { quoteSegment: 1, giftTimes: 2, targetPeriod: 'normal', targetUnitPriceCents: 60 });
    assert.deepEqual([preview.cumulativeReceivedCents, preview.remainingGiftTimes, preview.proposedTotalCents], [400, 5, 420]);
    const offered = await propose(order, input);
    const decision = { ...action(offered), decision: 'accept' };
    const accepted = await decide(order, decision, 201, owner, peer);
    assert.deepEqual(await decide(order, decision), accepted);
    assert.deepEqual([accepted.cumulativeReceivedCents, accepted.supplementReceivedCents], [400, 0]);
    await diary(order, worker, original, report(day(5), 1, 1, 2, 'double'), 409);
    const firstPayment = payment(accepted, 'supplement', 20);
    const [firstPaid, replay] = await Promise.all([
      pay(order, firstPayment), pay(order, firstPayment, 201, dispatcher, peer),
    ]);
    assert.deepEqual(replay, firstPaid);
    assert.equal(firstPaid.newQuoteSegment, 2);
    assert.equal(firstPaid.payments.length, 1);
    assert.equal((await diary(order, worker, original, firstReport)).id, firstFact.id);

    const receipt = await extend(order, 2, 90, day(3));
    assert.equal(receipt.segmentIndex, 2);
    await call(dispatcher, order.path + '/gift-dispatch', 'POST', {
      requestId: randomUUID(), segments: [publicWindow(2, day(3))],
    });
    const extra = await claim(order, worker, 2, 2);
    assert.equal(extra.accountId, original.accountId);

    const next = await proposal(order, { quoteSegment: 2, giftTimes: 2, targetPeriod: 'double', targetUnitPriceCents: 70 });
    assert.deepEqual([next.preview.cumulativeReceivedCents, next.preview.proposedTotalCents,
      next.preview.originalUnitPriceCents, next.preview.agreedGiftTimes], [600, 620, 60, 10]);
    const second = await propose(order, next.input);
    await propose(order, { ...input, reason: '改写旧请求' }, 409);
    const offline = { ...action(second), decision: 'accept', occurredAt: new Date().toISOString(), evidence: '电话协商编号 A-02' };
    const agreed = await call(dispatcher, order.amendments + '/decision', 'POST', offline, 201, peer);
    assert.equal(agreed.decision.source, 'offline');
    assert.equal(agreed.decision.decidedByUserId, dispatcher.id);
    const secondPayment = await pay(order, payment(agreed, 'supplement', 20));
    assert.equal(secondPayment.newQuoteSegment, 4);
    assert.equal((await propose(order, input)).id, offered.id);
    assert.equal((await decide(order, decision)).id, offered.id);
    assert.equal((await pay(order, firstPayment)).id, offered.id);

    const amendedShare = (await supervision(order)).segments[3].members[0].shares[0].shareId;
    await diary(order, worker, { ...original, shareId: amendedShare }, report(day(5), 4, 2, 4, 'double'));
    await diary(order, worker, original, report(day(4), 1, 3, 6, 'double'));
    await diary(order, worker, extra, report(day(3), 3, 2, 2, 'normal'));
    const saved = await details(order, peer);
    const progress = saved.deliveryProgress;
    assert.deepEqual(progress.segments.map(segment => [segment.agreedGiftTimes, segment.unitPriceCents, segment.deliveredGiftTimes]),
      [[6, 50, 6], [0, 60, 0], [2, 90, 2], [2, 70, 2]]);
    assert.equal(progress.segments[0].dailyGiftTimes, 8);
    assert.deepEqual([saved.quote.totalAmountCents, saved.receipt.receivedAmountCents,
      progress.deliveredGiftTimes, progress.remainingGiftTimes, progress.actualReceivedHearts,
      progress.priceAdjustment.supplementReceivedCents, progress.priceAdjustment.netReceivedCents], [400, 400, 10, 0, 18, 40, 620]);
    const customerPayment = progress.priceAdjustmentHistory[0].payments[0];
    assert.deepEqual(customerPayment, {
      kind: 'supplement', amountCents: firstPayment.amountCents, occurredAt: firstPayment.occurredAt,
    });
    const audited = await supervision(order);
    assert.equal(audited.priceAdjustmentHistory[0].payments[0].requestId, firstPayment.requestId);
    const basis = audited.promotionBasis;
    assert.deepEqual([basis.customerServiceCents, basis.dispatchFeeCents, basis.clubFeeCents, basis.memberFeeCents], [620, 50, 50, 520]);

    // The fully moved second segment retains its number, including after another receipt.
    assert.equal((await extend(order, 1, 80, day(2))).segmentIndex, 4);
    const extended = (await details(order)).deliveryProgress;
    assert.deepEqual([extended.agreedGiftTimes, extended.deliveredGiftTimes, extended.priceAdjustment.cumulativeReceivedCents], [11, 10, 700]);
  });

  await t.test('拒补停送，旧试算和越权操作失败，分次实退在重启后仍可安全重试', async () => {
    const order = await publish('direct_dispatch', 6, day(6));
    const firstShare = await claim(order, worker, 0, 3);
    const nextShare = await claim(order, partner, 0, 3);
    await diary(order, worker, firstShare, report(day(6), 1, 3, 6, 'double'));
    const shift = { quoteSegment: 1, giftTimes: 2, targetPeriod: 'normal', targetUnitPriceCents: 60 };
    const stale = await proposal(order, shift);
    const past = report(day(6), 1, 1, 2, 'double');
    const savedReport = await diary(order, partner, nextShare, past);
    await propose(order, stale.input, 409);
    const next = await proposal(order, shift);
    assert.equal(next.preview.refundIfDeclinedCents, 100);
    await propose(order, next.input, 404, partner);
    await propose(order, { ...next.input, reason: '  ' }, 400);
    const offered = await propose(order, next.input);
    const decision = { ...action(offered), decision: 'decline' };
    await decide(order, decision, 404, other);
    const declined = await decide(order, decision);
    assert.deepEqual(await decide(order, decision, 201, owner, peer), declined);
    await decide(order, { ...action(offered), decision: 'accept' }, 409, owner, peer);
    assert.deepEqual([declined.state, declined.originalReceivedCents, declined.refundDueCents,
      declined.refundedCents, declined.supplementReceivedCents], ['stopped', 300, 100, 0, 0]);
    await diary(order, partner, nextShare, report(day(5), 1, 1, 2, 'double'), 409);
    assert.equal((await diary(order, partner, nextShare, past)).id, savedReport.id);

    const firstRefund = payment(declined, 'refund', 40);
    await pay(order, firstRefund, 404, worker);
    const partial = await pay(order, firstRefund, 201, dispatcher, peer);
    await pay(order, { ...firstRefund, ...action(partial) }, 409);
    await pay(order, payment(partial, 'refund', 61), 409);
    const secondRefund = payment(partial, 'refund', 60);
    const refunded = await pay(order, secondRefund);
    assert.deepEqual([refunded.refundedCents, refunded.netReceivedCents], [100, 200]);

    await restartServer();
    assert.deepEqual(await pay(order, secondRefund), refunded);
    await pay(order, payment(refunded, 'refund', 1), 409, dispatcher, peer);
    const saved = await details(order);
    const progress = saved.deliveryProgress;
    assert.deepEqual([saved.quote.totalAmountCents, saved.receipt.receivedAmountCents,
      progress.fulfillmentStatus, progress.deliveredGiftTimes, progress.actualReceivedHearts],
    [300, 300, 'stopped', 4, 8]);
    assert.deepEqual(progress.priceAdjustment.payments, [firstRefund, secondRefund].map(({ kind, amountCents, occurredAt }) =>
      ({ kind, amountCents, occurredAt })));
    const audited = await supervision(order);
    assert.deepEqual(audited.priceAdjustment.payments.map(entry => [entry.requestId, entry.amountCents, entry.refundDueAtRecordingCents]),
      [[firstRefund.requestId, 40, 100], [secondRefund.requestId, 60, 100]]);
    const basis = audited.promotionBasis;
    assert.deepEqual([basis.customerServiceCents, basis.dispatchFeeCents, basis.clubFeeCents, basis.memberFeeCents], [200, 20, 20, 160]);
  });
});
