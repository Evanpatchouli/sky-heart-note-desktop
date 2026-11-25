import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { calculateQuoteAmounts } from '@webapp-template/common';
import { startClubSystem } from './club-test-system.mjs';

const quote = (period, hearts, unitPriceCents) => ({ period, hearts, unitPriceCents });
const line = (period, giftTimes, receivedHearts, quoteSegment) => ({
  period, giftTimes, receivedHearts, quoteSegment,
});

test('历史按颗订单的分期实绩、拟价差与客户公开进度从真实日报核对', { timeout: 150000 }, async (t) => {
  const { api, db, administrator, seedClub, register } = await startClubSystem(t, {
    database: 'club_delivery_review_e2e',
    adminUsername: 'period_review_admin',
  });
  const dispatcher = await register('period_host', 'employee');
  const worker = await register('period_worker', 'employee');
  const partner = await register('period_partner', 'employee');
  const owner = await register('period_customer', 'client');
  const other = await register('period_other_customer', 'client');
  const call = (actor, path, method = 'GET', body, status = method === 'POST' ? 201 : 200, app = 'employee') =>
    api(app, path, { token: actor.token, method, body, status });
  const routes = '/employee/club';
  const customerRoutes = '/client/orders';
  const orderRows = db.collection('club_orders');
  const storedOrder = (requestId) => orderRows.findOne(
    { requestId }, { projection: { publication: 0, updatedAt: 0 } },
  );
  const totalCalculations = () => db.collection('club_settlement_calculations').countDocuments();
  await seedClub('name', '分期核对');
  for (const actor of [administrator, dispatcher, worker, partner]) {
    await seedClub('member', actor.id, 'active', actor === dispatcher ? 'dispatcher' : 'member');
  }
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await call(administrator, '/admin/club/commission-rule', 'PATCH', {
    expectedVersion: 0, basis: 'gift_times', clubFeeCents: 5,
  }, 200, 'admin');
  const personal = new Map();
  for (const actor of [worker, partner]) {
    await call(actor, '/employee/songxinhao', 'POST', { name: '本人送心号' });
    personal.set(actor.id, (await call(actor, '/employee/songxinhao/linkable'))[0].id);
  }

  async function seedPublishedOrder(segments, discountedHeartsAmountCents) {
    const requestId = randomUUID();
    const requestedHearts = segments.reduce((sum, segment) => sum + segment.hearts, 0);
    const deliveryTarget = segments.reduce((sum, segment) => sum + segment.hearts + (segment.giftHearts ?? 0), 0);
    const amounts = calculateQuoteAmounts(segments, discountedHeartsAmountCents);
    assert.ok(amounts);
    const publishedAt = new Date('2026-11-01T00:00:00+08:00');
    // Published historical orders retain their old commission snapshot after the club moves to per-gift pricing.
    const { insertedId } = await orderRows.insertOne({
      clubId: 'club', requestId, source: 'client_order', businessType: 'heart_delivery',
      createdByUserId: owner.id, dispatcherUserId: dispatcher.id, customerUserId: owner.id, customerLinkStatus: 'verified',
      dispatchStatus: 'published', recipientGameAccount: '客户游戏号', heartDelivery: { requestedHearts },
      publishedAt, createdAt: publishedAt, fulfillmentRevision: 0, shares: [],
      dispatchPricing: {
        revision: 1, version: 1, basis: 'received_hearts', dispatchFeeCents: 5, clubFeeCents: 5, segments,
        ...(discountedHeartsAmountCents === undefined ? {} : { discountedHeartsAmountCents }),
      },
      receipt: {
        requestId: randomUUID(), receivedByUserId: dispatcher.id, recordedByUserId: dispatcher.id,
        receivedAmountCents: amounts.totalAmountCents, receivedAt: publishedAt, recordedAt: publishedAt,
        quote: { revision: 1, segments, ...amounts },
      },
      allocation: { requestId: randomUUID(), publicHearts: deliveryTarget, publicRemainingHearts: deliveryTarget, directed: [] },
    });
    return { id: insertedId.toHexString(), requestId, path: `${routes}/orders/${insertedId}`, deliveryTarget };
  }

  async function assignment(order, actor = worker, hearts = order.deliveryTarget) {
    const share = await call(actor, `${routes}/claim-board/${order.id}/claims`, 'POST', {
      requestId: randomUUID(), kind: 'public', hearts,
    });
    const accounts = `${order.path}/shares/${share.id}/execution-accounts`;
    const account = await call(actor, accounts, 'POST', { personalAccountId: personal.get(actor.id) });
    const target = `${accounts}/${account.id}`;
    return (day, lines) => call(actor, `${target}/daily-reports`, 'POST', {
      requestId: randomUUID(), businessDate: `2026-11-${day}`, kind: 'daily', lines,
    });
  }

  const fulfillment = (order, suffix = '') => call(dispatcher, `${order.path}/fulfillment${suffix}`);
  const customer = (order, actor = owner, status = 200) =>
    call(actor, `${customerRoutes}/${order.id}`, 'GET', undefined, status, 'client');
  const preview = (order, input, actor = dispatcher, status = 201, app = 'employee') =>
    call(actor, `${order.path}/fulfillment/historical-price-preview`, 'POST', input, status, app);
  const mixedQuote = [quote('double', 120, 35), quote('normal', 80, 50)];
  const mixed = await seedPublishedOrder(mixedQuote);
  const beforeReviews = await totalCalculations();
  const stored = await orderRows.findOne({ requestId: mixed.requestId });

  const empty = await fulfillment(mixed);
  assert.equal(empty.remainingHearts, 200);
  assert.deepEqual(empty.deliveryReview.periods.map(({ receivedHearts, giftTimes }) => [receivedHearts, giftTimes]),
    [[0, 0], [0, 0], [0, 0]]);
  assert.equal(empty.deliveryReview.comparison.original.totalCents, 8200);
  assert.equal(empty.deliveryReview.comparison.proposal, null);
  assert.deepEqual(empty.deliveryReview.comparison.issues, ['incomplete']);
  assert.equal((await customer(mixed)).quote.totalAmountCents, 8200);

  const reportA = await assignment(mixed, worker, 150);
  const reportB = await assignment(mixed, partner, 50);
  await reportA('05', [line('normal', 2, 2, 2), line('double', 2, 4, 1)]);
  const actualSix = await fulfillment(mixed);
  assert.deepEqual([actualSix.observedHearts, actualSix.creditedHearts, actualSix.remainingHearts], [6, 6, 194]);
  assert.deepEqual(actualSix.deliveryReview.periods.map(({ period, giftTimes, receivedHearts }) => [period, giftTimes, receivedHearts]),
    [['normal', 2, 2], ['double', 2, 4], ['unconfirmed', 0, 0]]);
  assert.equal(actualSix.deliveryReview.comparison.proposal, null);

  await reportA('06', [line('double', 53, 106, 1), line('normal', 38, 38, 2)]);
  await reportB('06', [line('normal', 50, 50, 2)]);
  const full = await fulfillment(mixed);
  const review = full.deliveryReview;
  assert.equal(full.remainingHearts, 0);
  assert.deepEqual(review.segments.map(({ number, plannedHearts, giftTimes, receivedHearts, pendingHearts }) =>
    [number, plannedHearts, giftTimes, receivedHearts, pendingHearts]), [[1, 120, 55, 110, 10], [2, 80, 90, 90, 0]]);
  assert.deepEqual(review.comparison.issues, []);
  assert.equal(review.comparison.original.ruleVersion, 1);
  assert.equal(review.comparison.original.receivedCents, 8200);
  assert.deepEqual(review.comparison.proposal, {
    basis: 'recorded_delivery', heartsCents: 8350, totalCents: 8350, differenceCents: 150,
    lines: [
      { quoteSegment: 1, period: 'double', unitPriceCents: 35, recordedHearts: 110, assumedHearts: 0, shiftedHearts: 0 },
      { quoteSegment: 2, period: 'normal', unitPriceCents: 50, recordedHearts: 90, assumedHearts: 0, shiftedHearts: 0 },
    ],
  });
  const mine = (await call(worker, mixed.path)).delivery;
  assert.deepEqual(mine.periodBreakdown.periods.map(({ period, giftTimes, receivedHearts }) => [period, giftTimes, receivedHearts]),
    [['normal', 40, 40], ['double', 55, 110], ['unconfirmed', 0, 0]]);
  assert.equal(mine.periodBreakdown.segments[1].pendingHearts, null);
  assert.equal(mine.orderRemainingHearts, 0);
  assert.ok(!JSON.stringify(mine).includes('comparison'));
  await call(worker, `${mixed.path}/fulfillment/reports`, 'GET', undefined, 404);
  const evidence = await fulfillment(mixed, '/reports?through=2026-11-05');
  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0].lines[0].quoteSegment, 2);
  const dated = await fulfillment(mixed, '?through=2026-11-05');
  assert.equal(dated.observedHearts, 6);
  assert.equal(dated.deliveryReview.comparison.proposal, null);
  assert.ok(dated.deliveryReview.comparison.issues.includes('historical_view'));
  assert.equal(dated.deliveryReview.comparison.canPreviewRemaining, false);
  const publicOrder = await customer(mixed);
  assert.equal(publicOrder.receipt.receivedAmountCents, 8200);
  assert.deepEqual(publicOrder.quote.segments, mixedQuote);
  assert.deepEqual(publicOrder.deliveryProgress, {
    agreedDeadline: null, observedHearts: 200, creditedHearts: 200, remainingHearts: 0,
  });
  for (const key of ['deliveryReview', 'comparison', 'quoteSegment', 'accountId', 'giftTimes']) {
    assert.ok(!JSON.stringify(publicOrder).includes(`"${key}"`));
  }
  await customer(mixed, other, 404);
  const saved = await orderRows.findOne({ requestId: mixed.requestId });
  for (const key of ['pricing', 'dispatchPricing', 'receipt']) assert.deepEqual(saved[key], stored[key]);
  assert.equal(await totalCalculations(), beforeReviews);

  const negative = await seedPublishedOrder(mixedQuote);
  await (await assignment(negative))('05', [line('double', 65, 130, 1), line('normal', 70, 70, 2)]);
  assert.equal((await fulfillment(negative)).deliveryReview.comparison.proposal.differenceCents, -150);
  await orderRows.updateOne({ requestId: negative.requestId }, { $set: { 'receipt.receivedAmountCents': 8000 } });
  const mismatch = (await fulfillment(negative)).deliveryReview.comparison;
  assert.equal(mismatch.original.totalCents, 8200);
  assert.equal(mismatch.original.receivedCents, 8000);
  assert.equal(mismatch.proposal, null);
  assert.deepEqual(mismatch.issues, ['receipt_amount_mismatch']);

  const future = await seedPublishedOrder([quote('double', 200, 35)]);
  await (await assignment(future))('05', [line('double', 95, 190, 1)]);
  const partial = (await fulfillment(future)).deliveryReview.comparison;
  assert.equal(partial.original.totalCents, 7000);
  assert.equal(partial.canPreviewRemaining, true);
  assert.equal(partial.proposal, null);
  const shift = { quoteSegment: 1, hearts: 10, targetPeriod: 'normal', targetUnitPriceCents: 50 };
  const beforePreview = await storedOrder(future.requestId);
  const result = await preview(future, shift);
  assert.equal(result.proposal.basis, 'remaining_scenario');
  assert.deepEqual([result.proposal.totalCents, result.proposal.differenceCents], [7150, 150]);
  assert.deepEqual(result.proposal.lines[1], {
    quoteSegment: 1, period: 'normal', unitPriceCents: 50, recordedHearts: 0, assumedHearts: 0, shiftedHearts: 10,
  });
  assert.equal((await preview(future, { ...shift, targetUnitPriceCents: 49 })).proposal.differenceCents, 140);
  assert.deepEqual((await preview(future, { ...shift, hearts: 1 })).issues, ['double_quantity_unresolved']);
  assert.deepEqual((await preview(future, { ...shift, hearts: 12 })).issues, ['shift_exceeds_remaining']);
  await preview(future, { ...shift, targetUnitPriceCents: undefined }, dispatcher, 400);
  await preview(future, shift, worker, 404);
  await preview(future, shift, owner, 403, 'client');
  assert.deepEqual(await storedOrder(future.requestId), beforePreview);
  assert.equal(await totalCalculations(), beforeReviews);
  assert.equal((await fulfillment(future)).observedHearts, 190);

  const ambiguous = await seedPublishedOrder([quote('normal', 4, 40), quote('normal', 4, 60)]);
  const basisReport = await (await assignment(ambiguous))('05', [
    line('normal', 4, 4, 1), line('normal', 4, 4),
  ]);
  const awaiting = (await fulfillment(ambiguous)).deliveryReview;
  assert.equal(awaiting.comparison.proposal, null);
  assert.deepEqual(awaiting.comparison.issues, ['unmatched_period']);
  assert.deepEqual(awaiting.links.map(({ quoteSegment, receivedHearts, matchesQuote }) =>
    [quoteSegment, receivedHearts, matchesQuote]), [[null, 4, false], [1, 4, true]]);
  await call(worker, `${ambiguous.path}/daily-reports/${basisReport.id}/corrections`, 'POST', {
    requestId: randomUUID(), expectedVersion: 1, reason: '申请补充正确的报价段号',
    lines: [line('normal', 4, 4, 1), line('normal', 4, 4, 2)],
  });
  assert.deepEqual((await fulfillment(ambiguous)).deliveryReview.comparison.issues,
    ['pending_reports', 'unmatched_period']);

  const over = await seedPublishedOrder([quote('double', 3, 35)]);
  await (await assignment(over))('05', [line('double', 2, 4, 1)]);
  const extra = await fulfillment(over);
  assert.deepEqual([extra.observedHearts, extra.creditedHearts, extra.remainingHearts], [4, 3, 0]);
  assert.deepEqual(extra.deliveryReview.comparison.issues, ['excess_delivery']);
  assert.equal(extra.deliveryReview.comparison.proposal, null);

  const plain = await seedPublishedOrder([quote('normal', 4, 50)]);
  await (await assignment(plain))('05', [line('normal', 4, 4, 1)]);
  assert.equal((await fulfillment(plain)).deliveryReview.comparison.proposal.differenceCents, 0);
  const gift = await seedPublishedOrder([{ ...quote('normal', 5, 50), giftHearts: 1 }]);
  await (await assignment(gift))('05', [line('normal', 6, 6, 1)]);
  const giftReview = (await fulfillment(gift)).deliveryReview;
  assert.deepEqual(giftReview.segments.map(({ plannedHearts, paidHearts, giftHearts }) => [plannedHearts, paidHearts, giftHearts]),
    [[6, 5, 1]]);
  assert.deepEqual(giftReview.comparison.issues, ['promotion_allocation']);
  assert.equal(giftReview.comparison.proposal, null);
  assert.equal((await customer(gift)).receipt.receivedAmountCents, 250);
  const discount = await seedPublishedOrder([quote('normal', 6, 50)], 240);
  await (await assignment(discount))('05', [line('normal', 6, 6, 1)]);
  assert.deepEqual((await fulfillment(discount)).deliveryReview.comparison.issues, ['promotion_allocation']);
  assert.equal((await customer(discount)).quote.heartsAmountCents, 240);

  await t.test('按次订单的到账倍率变化无法产生补退记录', async () => {
    const requestId = randomUUID();
    const order = await call(owner, customerRoutes, 'POST', {
      requestId, recipientGameAccount: '按次客户游戏号', dispatcherUserId: dispatcher.id,
      requestedGiftTimes: 4, deliveryPeriodPreference: 'normal',
    }, 201, 'client');
    const path = `${routes}/orders/${order.id}`;
    await call(dispatcher, `${path}/pricing`, 'PATCH', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
      giftSegments: [{ period: 'normal', paidGiftTimes: 4, dailyGiftTimes: 4, unitPriceCents: 50 }],
    });
    await call(dispatcher, `${path}/receipts`, 'POST', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 200, receivedAt: '2026-11-01T00:00:00+08:00',
    });
    await call(dispatcher, `${path}/publish`, 'POST', {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: [{ segmentIndex: 0, startDate: '2026-11-05', endDate: '2026-11-05', openToClaim: true, directed: [] }],
    });
    const share = await call(worker, `${routes}/gift-claims/${order.id}`, 'POST', {
      requestId: randomUUID(), kind: 'public', segmentIndex: 0, dailyGiftTimes: 4,
    });
    const accounts = `${path}/shares/${share.shareId}/execution-accounts`;
    const account = await call(worker, accounts, 'POST', { personalAccountId: personal.get(worker.id) });
    const changePeriod = { quoteSegment: 1, giftTimes: 4, targetPeriod: 'double', targetUnitPriceCents: 50 };
    const comparison = await call(dispatcher, `${path}/fulfillment/price-preview`, 'POST', changePeriod);
    assert.deepEqual([comparison.differenceCents, comparison.proposedTotalCents, comparison.adjustmentReview], [
      0, 200, { unavailable: 'no_price_change' },
    ]);
    await call(worker, `${accounts}/${account.id}/daily-reports`, 'POST', {
      requestId: randomUUID(), businessDate: '2026-11-05', kind: 'daily',
      lines: [line('double', 4, 8, 1)],
    });
    const facts = await fulfillment({ path });
    assert.deepEqual([facts.deliveredGiftTimes, facts.actualReceivedHearts, facts.heartAmountCents, facts.periodOnlyDifferenceCents], [4, 8, 200, 0]);
    const before = await storedOrder(requestId);
    await call(dispatcher, `${path}/price-adjustment`, 'POST', {
      ...changePeriod, requestId: randomUUID(), expectedVersion: 'a'.repeat(64), reason: '只改变到账倍率',
    }, 409);
    for (const kind of ['supplement', 'refund']) {
      await call(dispatcher, `${path}/price-adjustment/payments`, 'POST', {
        requestId: randomUUID(), adjustmentId: order.id, expectedRevision: 1, kind,
        amountCents: 50, occurredAt: '2026-11-05T00:00:00+08:00',
      }, 409);
    }
    assert.deepEqual(await storedOrder(requestId), before);
    assert.equal(await totalCalculations(), beforeReviews);
  });
});
