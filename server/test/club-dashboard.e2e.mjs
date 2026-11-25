import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { ClubDashboardService } from '../dist/src/modules/club/club-dashboard.service.js';
import { startClubSystem } from './club-test-system.mjs';

test('运营总览按权限、来源和业务状态汇总，并与订单及资金明细一致', { timeout: 120_000 }, async (t) => {
  const { api, db, administrator, register, seedClub } = await startClubSystem(t, {
    database: 'club_dashboard_e2e', adminUsername: 'dashboard_admin',
  });
  const dispatcher = await register('dashboard_dispatcher', 'employee');
  const worker = await register('dashboard_worker', 'employee');
  const customer = await register('dashboard_customer', 'client');
  const operations = await register('dashboard_operations', 'admin');
  const finance = await register('dashboard_finance', 'admin');
  for (const actor of [administrator, operations, finance, worker]) await seedClub('member', actor.id, 'active', 'member');

  const get = (app, actor, path, status = 200) => api(app, path, { token: actor.token, status });
  const write = (app, actor, path, body, method = 'POST') => api(app, path, {
    token: actor.token, body, method, status: method === 'POST' ? 201 : 200,
  });
  const dashboardPath = '/admin/club/dashboard';
  const dashboard = (actor = administrator, status) => get('admin', actor, dashboardPath, status);
  const list = (query = {}, actor = administrator, status) => get('admin', actor,
    `${dashboardPath}/orders?${new URLSearchParams(query)}`, status);
  const detail = (id, actor = administrator, status) => get('admin', actor, `${dashboardPath}/orders/${id}`, status);
  const settlement = (id, actor = administrator, status) => get('admin', actor, `/admin/club/orders/${id}/settlement`, status);
  const metricRows = async (metric, actor) => (await list({ metric }, actor)).items;
  const ids = rows => rows.map(row => row.orderId).sort();

  assert.deepEqual(await dashboard(), {});
  await list({}, operations, 403);
  await seedClub('grant', administrator.id, 'CLUB_ORDERS_READ');
  await seedClub('grant', administrator.id, 'CLUB_FINANCE_READ');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await seedClub('grant', operations.id, 'CLUB_ORDERS_READ');
  await seedClub('grant', finance.id, 'CLUB_FINANCE_READ');
  await write('admin', administrator, '/admin/club/commission-rule', { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  const emptySources = ['client_order', 'direct_dispatch'].map(source => ({
    source, orders: 0, deliveredGiftTimes: 0, knownReceivedHearts: 0, knownReceivedLines: 0, unknownReceivedLines: 0,
  }));
  const empty = await dashboard();
  assert.deepEqual({ ...empty.operations, sources: empty.operations.sources.toSorted((a, b) => a.source.localeCompare(b.source)) }, {
    pendingOrders: 0, claimableGiftTimes: 0, deliveredGiftTimes: 0, knownReceivedHearts: 0,
    knownReceivedLines: 0, unknownReceivedLines: 0, actionOrders: 0, sources: emptySources, attention: [],
  });
  assert.deepEqual(empty.finance, { readyOrders: 0, readyNetCents: 0, clubBalanceCents: 0, ready: [] });
  assert.deepEqual(await list(), { items: [], nextCursor: null });
  assert.deepEqual(await get('admin', finance, '/admin/club/balance'), { balanceCents: 0, entries: [] });
  assert.deepEqual(await dashboard(operations), { operations: empty.operations });
  assert.deepEqual(await dashboard(finance), { finance: empty.finance });
  await list({ metric: 'ready_to_close' }, operations, 403);
  await list({ metric: 'claimable' }, finance, 403);
  await list({ metric: 'unknown' }, administrator, 400);
  await list({ after: 'invalid' }, administrator, 400);

  const employeeOrders = '/employee/club/orders';
  const clientOrders = '/client/orders';
  const orderPath = id => `${employeeOrders}/${id}`;
  const requested = (recipientGameAccount, requestedGiftTimes) => ({ requestId: randomUUID(), recipientGameAccount, requestedGiftTimes });
  const unassigned = await write('client', customer, clientOrders, requested('尚未分配派单人', 1));
  assert.equal(unassigned.dispatchStatus, 'pending_assignment');
  assert.equal((await detail(unassigned.id)).pendingDispatch, false);
  assert.deepEqual(await metricRows('pending_dispatch'), []);
  assert.equal((await dashboard()).operations.pendingOrders, 0);
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');

  const normal = await write('employee', dispatcher, employeeOrders, {
    ...requested('直接派单核对', 4), existingCustomerUserId: customer.id,
  });
  const refused = await write('client', customer, clientOrders, {
    ...requested('客户端拒补停送', 100), dispatcherUserId: dispatcher.id, deliveryPeriodPreference: 'double',
  });
  const pendingRows = await metricRows('pending_dispatch', operations);
  assert.deepEqual(ids(pendingRows), [normal.id, refused.id].sort());
  assert.equal((await dashboard()).operations.pendingOrders, pendingRows.length);
  assert.deepEqual((await list({ metric: 'pending_dispatch', source: 'direct_dispatch' }, operations)).items,
    [await detail(normal.id, operations)]);
  await detail(normal.id, finance, 403);
  await detail('0'.repeat(24), operations, 404);
  await settlement(normal.id, operations, 403);
  await get('employee', dispatcher, dashboardPath, 403);

  await write('employee', worker, '/employee/songxinhao', { name: '仪表盘验收送心号' });
  const [personalAccount] = await get('employee', worker, '/employee/songxinhao/linkable');
  const firstDay = '2026-11-20';
  const nextDay = '2026-11-21';
  async function payAndPublish(id, paidGiftTimes, dailyGiftTimes, period, endDate) {
    const path = orderPath(id);
    const { quote } = await write('employee', dispatcher, `${path}/pricing`, {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
      giftSegments: [{ period, paidGiftTimes, dailyGiftTimes, unitPriceCents: 50 }],
    }, 'PATCH');
    await write('employee', dispatcher, `${path}/receipts`, {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: quote.totalAmountCents, receivedAt: '2026-11-19T08:00:00+08:00',
    });
    await write('employee', dispatcher, `${path}/publish`, {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: [{ segmentIndex: 0, startDate: firstDay, endDate, openToClaim: true, directed: [] }],
    });
  }
  async function claim(id, dailyGiftTimes) {
    const { shareId } = await write('employee', worker, `/employee/club/gift-claims/${id}`, {
      requestId: randomUUID(), kind: 'public', segmentIndex: 0, dailyGiftTimes,
    });
    const path = `${orderPath(id)}/shares/${shareId}/execution-accounts`;
    const execution = await write('employee', worker, path, { personalAccountId: personalAccount.id });
    return `${path}/${execution.id}/daily-reports`;
  }
  const report = (path, businessDate, period, giftTimes, receivedHearts) => write('employee', worker, path, {
    requestId: randomUUID(), kind: 'daily', businessDate, lines: [{ period, giftTimes, receivedHearts }],
  });

  await payAndPublish(normal.id, 4, 2, 'normal', nextDay);
  const published = (await dashboard()).operations;
  assert.equal(published.pendingOrders, 1);
  assert.equal(published.claimableGiftTimes, 4);
  const claimableRow = await detail(normal.id, operations);
  assert.equal(claimableRow.claimableGiftTimes, published.claimableGiftTimes);
  assert.deepEqual(await metricRows('claimable', operations), [claimableRow]);
  const normalReports = await claim(normal.id, 2);
  assert.equal((await dashboard()).operations.claimableGiftTimes, 0);
  assert.deepEqual(await metricRows('claimable', operations), []);
  await report(normalReports, firstDay, 'normal', 2, null);
  const firstReport = (await dashboard()).operations;
  assert.deepEqual([firstReport.deliveredGiftTimes, firstReport.knownReceivedHearts, firstReport.knownReceivedLines,
    firstReport.unknownReceivedLines], [2, 0, 0, 1]);
  assert.deepEqual(await metricRows('fulfilled', operations), [await detail(normal.id, operations)]);
  assert.deepEqual(await metricRows('received', operations), [await detail(normal.id, operations)]);
  await report(normalReports, nextDay, 'normal', 2, 2);
  assert.deepEqual((await dashboard(finance)).finance, {
    readyOrders: 1, readyNetCents: 200, clubBalanceCents: 0, ready: [{ orderId: normal.id, netReceivedCents: 200 }],
  });
  assert.deepEqual(ids(await metricRows('ready_to_close', finance)), [normal.id]);
  assert.equal((await settlement(normal.id, finance)).cash.netReceivedCents, 200);

  async function proposePriceChange(id) {
    await payAndPublish(id, 100, 100, 'double', firstDay);
    await report(await claim(id, 100), firstDay, 'double', 95, 190);
    const path = orderPath(id);
    const shift = { quoteSegment: 1, giftTimes: 5, targetPeriod: 'normal', targetUnitPriceCents: 60 };
    const preview = await write('employee', dispatcher, `${path}/fulfillment/price-preview`, shift);
    return write('employee', dispatcher, `${path}/price-adjustment`, {
      ...shift, requestId: randomUUID(), expectedVersion: preview.adjustmentReview.version, reason: '跨期剩余五次的约定单价',
    });
  }
  const decide = (id, proposal, decision) => write('client', customer, `${clientOrders}/${id}/price-adjustment/decision`, {
    requestId: randomUUID(), adjustmentId: proposal.id, expectedRevision: proposal.revision, decision,
  });
  const recordAdjustmentPayment = (id, adjustment, kind, amountCents) => write('employee', dispatcher,
    `${orderPath(id)}/price-adjustment/payments`, {
      requestId: randomUUID(), adjustmentId: adjustment.id, expectedRevision: adjustment.revision, kind, amountCents,
      occurredAt: '2026-11-21T08:00:00+08:00',
    });
  async function assertAction(id) {
    const row = await detail(id, operations);
    assert.ok(row.actionLabel);
    const { operations: snapshot } = await dashboard(operations);
    assert.equal(snapshot.actionOrders, 1);
    assert.deepEqual(snapshot.attention.find(item => item.orderId === id), row);
    assert.deepEqual(await metricRows('action_required', operations), [row]);
    return row.actionLabel;
  }

  const proposal = await proposePriceChange(refused.id);
  const priceAction = await assertAction(refused.id);
  const declined = await decide(refused.id, proposal, 'decline');
  assert.equal(declined.refundDueCents, 250);
  const refundAction = await assertAction(refused.id);
  assert.notEqual(refundAction, priceAction);
  const partiallyRefunded = await recordAdjustmentPayment(refused.id, declined, 'refund', 100);
  assert.equal(await assertAction(refused.id), refundAction);
  await recordAdjustmentPayment(refused.id, partiallyRefunded, 'refund', 150);
  const afterRefund = await dashboard();
  assert.equal(afterRefund.operations.actionOrders, 0);
  assert.deepEqual(await metricRows('action_required', operations), []);
  assert.deepEqual(afterRefund.operations.sources.toSorted((a, b) => a.source.localeCompare(b.source)), [
    { source: 'client_order', orders: 2, deliveredGiftTimes: 95, knownReceivedHearts: 190, knownReceivedLines: 1, unknownReceivedLines: 0 },
    { source: 'direct_dispatch', orders: 1, deliveredGiftTimes: 4, knownReceivedHearts: 2, knownReceivedLines: 1, unknownReceivedLines: 1 },
  ]);
  assert.deepEqual([afterRefund.operations.deliveredGiftTimes, afterRefund.operations.knownReceivedHearts,
    afterRefund.operations.knownReceivedLines, afterRefund.operations.unknownReceivedLines], [99, 192, 2, 1]);
  for (const source of afterRefund.operations.sources) {
    const { items: fulfilled } = await list({ metric: 'fulfilled', source: source.source }, operations);
    const { items: received } = await list({ metric: 'received', source: source.source }, operations);
    assert.equal(fulfilled.reduce((sum, row) => sum + row.deliveredGiftTimes, 0), source.deliveredGiftTimes);
    assert.equal(received.reduce((sum, row) => sum + row.knownReceivedHearts, 0), source.knownReceivedHearts);
    assert.equal(received.reduce((sum, row) => sum + row.unknownReceivedLines, 0), source.unknownReceivedLines);
  }
  assert.deepEqual([afterRefund.finance.readyOrders, afterRefund.finance.readyNetCents], [2, 4950]);
  assert.deepEqual(ids(await metricRows('ready_to_close', finance)), [normal.id, refused.id].sort());
  assert.equal((await settlement(refused.id, finance)).cash.netReceivedCents, 4750);

  const supplemented = await write('client', customer, clientOrders, {
    ...requested('客户端同意补款', 100), dispatcherUserId: dispatcher.id, deliveryPeriodPreference: 'double',
  });
  const supplementProposal = await proposePriceChange(supplemented.id);
  const accepted = await decide(supplemented.id, supplementProposal, 'accept');
  assert.equal(accepted.state, 'awaiting_supplement');
  await assertAction(supplemented.id);
  await recordAdjustmentPayment(supplemented.id, accepted, 'supplement', 50);
  assert.equal((await dashboard()).operations.actionOrders, 0);
  assert.deepEqual(await metricRows('action_required', operations), []);
  assert.equal((await settlement(supplemented.id, finance)).cash.supplementReceivedCents, 50);

  const newerPending = await write('client', customer, clientOrders, {
    ...requested('尚未派发的分页订单', 1), dispatcherUserId: dispatcher.id,
  });
  assert.deepEqual(ids(await metricRows('pending_dispatch', operations)), [newerPending.id]);
  const firstPage = await list({ metric: 'received', source: 'client_order', limit: '1' }, operations);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  const secondPage = await list({ metric: 'received', source: 'client_order', limit: '1', after: firstPage.nextCursor }, operations);
  assert.deepEqual(ids([...firstPage.items, ...secondPage.items]), [refused.id, supplemented.id].sort());
  assert.equal(secondPage.nextCursor, null);
  for (const item of [...firstPage.items, ...secondPage.items]) assert.deepEqual(item, await detail(item.orderId, operations));

  for (const [id, clubBalanceCents, readyNetCents] of [[normal.id, 20, 4750], [refused.id, 495, 0]]) {
    const { finalCalculation } = await settlement(id, finance);
    await write('employee', dispatcher, `${orderPath(id)}/settlement/close`, { requestId: randomUUID(), calculationId: finalCalculation.id });
    const financial = (await dashboard(finance)).finance;
    assert.equal(financial.clubBalanceCents, clubBalanceCents);
    assert.equal(financial.readyNetCents, readyNetCents);
    const readyIds = readyNetCents ? [refused.id] : [];
    assert.equal(financial.readyOrders, readyIds.length);
    assert.deepEqual(ids(financial.ready), readyIds);
    assert.deepEqual(ids(await metricRows('ready_to_close', finance)), readyIds);
    const balance = await get('admin', finance, '/admin/club/balance');
    assert.equal(financial.clubBalanceCents, balance.balanceCents);
    assert.deepEqual(balance.entries.filter(entry => entry.orderId === id).map(entry => entry.calculationId), [finalCalculation.id]);
  }

  // Current order creation uses gift times. Restore an order in the historical heart-based format.
  const legacyOrderId = new mongoose.Types.ObjectId();
  const legacyId = legacyOrderId.toHexString();
  const legacyOrders = db.collection('club_orders');
  const legacyPublishedAt = new Date('2026-11-04T11:40:00Z');
  const legacySegments = [{ period: 'normal', hearts: 4, unitPriceCents: 50 }];
  await legacyOrders.insertOne({
    _id: legacyOrderId, clubId: 'club', source: 'direct_dispatch', businessType: 'heart_delivery',
    createdByUserId: dispatcher.id, dispatcherUserId: dispatcher.id, dispatcherAssignment: 'creator',
    requestId: randomUUID(), recipientGameAccount: '历史按颗价差', customerLinkStatus: 'pending_verification',
    dispatchStatus: 'published', publishedAt: legacyPublishedAt, createdAt: legacyPublishedAt, shares: [],
    heartDelivery: { requestedHearts: 4 },
    dispatchPricing: { revision: 1, version: 1, basis: 'received_hearts', dispatchFeeCents: 5, clubFeeCents: 5, segments: legacySegments },
    allocation: { requestId: randomUUID(), publicHearts: 4, publicRemainingHearts: 4, directed: [] },
    receipt: {
      requestId: randomUUID(), pricingRevision: 1, receivedAt: legacyPublishedAt, recordedAt: legacyPublishedAt,
      receivedAmountCents: 200, recordedByUserId: dispatcher.id, receivedByUserId: dispatcher.id,
      quote: { revision: 1, segments: legacySegments, heartsAmountCents: 200, totalAmountCents: 200 },
    },
  });
  assert.equal((await detail(legacyId, operations)).actionLabel, null);
  const legacyShift = { quoteSegment: 1, hearts: 2, targetPeriod: 'double', targetUnitPriceCents: 60 };
  const legacyAdjustment = `${orderPath(legacyId)}/historical-price-adjustment`;
  const legacyPreview = () => write('employee', dispatcher, `${orderPath(legacyId)}/fulfillment/historical-price-preview`, legacyShift);
  const manualPreview = await legacyPreview();
  const legacyReview = await write('employee', dispatcher, `${legacyAdjustment}/reviews`, {
    requestId: randomUUID(), expectedVersion: manualPreview.manualReviewVersion, reason: '旧单需先核对客户归属', shift: legacyShift,
  });
  assert.equal(await assertAction(legacyId), '改价待人工核对');
  assert.equal((await detail(legacyId, operations)).priceUnit, 'hearts');

  await legacyOrders.updateOne({ _id: legacyOrderId }, { $set: { customerUserId: customer.id, customerLinkStatus: 'verified' } });
  const formalPreview = await legacyPreview();
  const legacyProposal = await write('employee', dispatcher, legacyAdjustment, {
    ...legacyShift, requestId: randomUUID(), expectedVersion: formalPreview.adjustmentReview.version, reason: '客户已确认旧单归属',
  });
  assert.equal(await assertAction(legacyId), '改价待确认');
  const legacyAccepted = await write('client', customer, `${clientOrders}/${legacyId}/historical-price-adjustment/decision`, {
    requestId: randomUUID(), adjustmentId: legacyProposal.id, expectedRevision: legacyProposal.revision, decision: 'accept',
  });
  assert.equal(await assertAction(legacyId), '改价待补款');
  await write('employee', dispatcher, `${legacyAdjustment}/payments`, {
    requestId: randomUUID(), adjustmentId: legacyProposal.id, expectedRevision: legacyAccepted.revision,
    kind: 'supplement', amountCents: 20, occurredAt: '2026-11-05T08:00:00+08:00',
  });
  assert.equal((await legacyOrders.findOne({ _id: legacyOrderId })).priceAdjustmentReviews[0].id, legacyReview.id);
  assert.equal((await detail(legacyId, operations)).actionLabel, null);
  assert.deepEqual(await metricRows('action_required', operations), []);

  const opsOnly = await dashboard(operations);
  assert.deepEqual(Object.keys(opsOnly), ['operations']);
  assert.deepEqual(opsOnly.operations, (await dashboard()).operations);
  assert.deepEqual([opsOnly.operations.deliveredGiftTimes, opsOnly.operations.knownReceivedHearts,
    opsOnly.operations.unknownReceivedLines], [194, 382, 1]);
  assert.doesNotMatch(JSON.stringify([opsOnly, await list({}, operations), await detail(refused.id, operations)]), /"[^"]*Cents":/);
  await settlement(refused.id, operations, 403);
  await seedClub('revoke', administrator.id, 'CLUB_FINANCE_READ');
  assert.deepEqual(await dashboard(), opsOnly);
  await list({ metric: 'ready_to_close' }, administrator, 403);
  await get('admin', administrator, '/admin/club/balance', 403);
  await seedClub('revoke', administrator.id, 'CLUB_ORDERS_READ');
  assert.deepEqual(await dashboard(), {});
  await list({}, administrator, 403);
  await detail(normal.id, administrator, 403);
});

test('团费读取期间若发生结单，仪表盘重读待结单和团费余额', async () => {
  let closed = false;
  let balanceReads = 0;
  const service = new ClubDashboardService(
    { countDocuments: () => ({ readConcern: async () => Number(closed) }) },
    undefined,
    undefined,
    { getAdminClub: async () => ({ permissions: ['CLUB_FINANCE_READ'] }) },
    { financeBalance: async () => {
      balanceReads++;
      closed = true;
      return { balanceCents: 500, entries: [] };
    } },
    undefined,
  );
  service.projectedOrders = async function* () {
    if (!closed) yield { row: { orderId: 'ready-order' }, readyNetCents: 5000 };
  };

  assert.deepEqual(await service.dashboard({ id: 'FIN1' }), {
    finance: { readyOrders: 0, readyNetCents: 0, clubBalanceCents: 500, ready: [] },
  });
  assert.equal(balanceReads, 2);
});
