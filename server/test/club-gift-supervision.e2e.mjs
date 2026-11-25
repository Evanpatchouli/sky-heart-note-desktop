import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const employee = '/employee/club';
const client = '/client/orders';
const date = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
const objectId = (value) => new mongoose.Types.ObjectId(value);

test('按次监督、老板的三类实收观察、未结原单续段和历史按颗进度', { timeout: 120000 }, async (t) => {
  const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.supervision.test`]));
  const { db, base, password, seedClub } = await startSystem(t, {
    database: 'gift_supervision_e2e', adminUsername: 'supervision_admin', origins,
  });
  const challenges = new Map();
  async function call(app, path, actor, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200) {
    const headers = { origin: origins[app] };
    if (actor?.token) headers.authorization = `Bearer ${actor.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (path.startsWith('/user/') && challenges.has(app)) headers.cookie = challenges.get(app);
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path} ${JSON.stringify(result)}`);
    if (path.startsWith('/captcha/')) {
      const cookie = response.headers.getSetCookie().find(item => item.startsWith('sky_captcha_'));
      challenges.set(app, cookie.split(';')[0]);
    }
    return result.data;
  }
  async function login(app, username) {
    await call(app, `/captcha/login?app=${app}`);
    return call(app, '/user/login?type=account', null, { app, username, password, captcha: captchaCode });
  }
  async function customer(username) {
    await call('client', '/captcha/register?app=client');
    await call('client', '/user/register?type=account', null, { app: 'client', username, password, captcha: captchaCode });
    return login('client', username);
  }
  const operator = await login('employee', 'supervision_admin');
  const administrator = await login('admin', 'supervision_admin');
  const owner = await customer('supervision_owner');
  const outsider = await customer('supervision_outsider');
  await seedClub('name', '履约监督');
  await seedClub('member', operator.id, 'active', 'dispatcher');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  const rule = (expectedVersion, clubFeeCents) => call('admin', '/admin/club/commission-rule', administrator,
    { expectedVersion, clubFeeCents }, 'PATCH');
  await rule(0, 5);
  const invitation = async username => {
    const { invitationUrl } = await call('employee', `${employee}/member-invitations`, operator, {});
    const token = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('token');
    await call('client', '/client/club-invitations/register', null, { token, username, password });
    return login('employee', username);
  };
  const member = await invitation('supervision_executor');
  const substitute = await invitation('supervision_substitute');
  const ep = (path, actor, body, method, status) => call('employee', path, actor, body, method, status);
  const cp = (path, actor, body, method, status) => call('client', path, actor, body, method, status);
  async function publish(source, segments, window, customer = owner) {
    const giftSegments = Array.isArray(segments) ? segments : [segments];
    const requested = { requestId: randomUUID(),
      requestedGiftTimes: giftSegments.reduce((total, segment) => total + segment.paidGiftTimes, 0),
      recipientGameAccount: `${source} 的游戏号`, deliveryPeriodPreference: giftSegments.length > 1 ? 'split' : giftSegments[0].period,
      ...(giftSegments.length > 1 ? { doubleGiftTimes: giftSegments.filter(segment => segment.period === 'double')
        .reduce((total, segment) => total + segment.paidGiftTimes, 0) } : {}),
    };
    const order = source === 'direct_dispatch'
      ? await ep(`${employee}/orders`, operator, { ...requested, existingCustomerUserId: customer.id })
      : await cp(client, customer, { ...requested, dispatcherUserId: operator.id });
    const path = `${employee}/orders/${order.id}`;
    const { quote } = await ep(path + '/pricing', operator, {
      ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 5, giftSegments,
    }, 'PATCH');
    await ep(path + '/receipts', operator, {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: quote.totalAmountCents, receivedAt: '2026-11-18T08:00:00Z',
    });
    await ep(path + '/publish', operator, { requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1,
      commissionReviewRevision: 0, giftDispatchSegments: giftSegments.map((_, segmentIndex) => ({ segmentIndex, ...window, openToClaim: true, directed: [] })) });
    return { id: order.id, path, customerPath: `${client}/${order.id}`, claimPath: `${employee}/gift-claims/${order.id}` };
  }
  const read = order => cp(order.customerPath, owner);
  const giftProgress = async order => (await read(order)).deliveryProgress;
  const claim = (order, fields, actor = member) =>
    ep(order.claimPath, actor, { requestId: randomUUID(), segmentIndex: 0, kind: 'public', ...fields });
  await t.test('已付款的两个来源均按剩余次数改价，实补后续送，拒补按原实收实退', async () => {
    const segment = { period: 'double', paidGiftTimes: 100, dailyGiftTimes: 10, unitPriceCents: 50 };
    const window = { startDate: '2026-11-12', endDate: '2026-11-21' };
    for (const [actor, name] of [[member, '改价送心甲'], [substitute, '改价送心乙']])
      await ep('/employee/songxinhao', actor, { name });
    const branches = [
      ['direct_dispatch', 'accept', 'normal'],
      ['client_order', 'decline', 'double'],
    ];
    for (const [source, decision, targetPeriod] of branches) {
      const order = await publish(source, segment, window);
      const { path } = order;
      const reportPath = (share, account) => `${path}/shares/${share}/execution-accounts/${account}/daily-reports`;
      const workers = [];
      for (const [actor, days] of [[member, 10], [substitute, 9]]) {
        const { shareId } = await claim(order, { dailyGiftTimes: 5 }, actor);
        const [personal] = await ep('/employee/songxinhao/linkable', actor);
        const account = await ep(`${path}/shares/${shareId}/execution-accounts`, actor, { personalAccountId: personal.id });
        let lastReport;
        for (let index = 0; index < days; index++) {
          const sameDayAsRepriced = decision === 'accept' && actor === substitute && index === days - 1;
          lastReport = await ep(reportPath(shareId, account.id), actor, {
            requestId: randomUUID(), kind: 'daily', businessDate: sameDayAsRepriced ? window.endDate : `2026-11-${12 + index}`,
            lines: [{ period: 'double', giftTimes: 5, receivedHearts: 10 }],
          });
        }
        workers.push({ actor, shareId, account: account.id, lastReport });
      }
      const previewPath = path + '/fulfillment/price-preview';
      const proposalPath = path + '/price-adjustment';
      const decisionPath = order.customerPath + '/price-adjustment/decision';
      const planned = { quoteSegment: 1, giftTimes: 5, targetPeriod, targetUnitPriceCents: 60 };
      const zero = await ep(previewPath, operator, { ...planned, targetPeriod: 'normal', targetUnitPriceCents: 50 });
      assert.equal(zero.differenceCents, 0);
      assert.equal(zero.adjustmentReview.unavailable, 'no_price_change');
      const lower = await ep(previewPath, operator, { ...planned, targetUnitPriceCents: 40 });
      assert.equal(lower.differenceCents, -50);
      assert.equal(lower.adjustmentReview.unavailable, 'lower_price');
      await ep(previewPath, member, planned, 'POST', 404);
      await ep(previewPath, operator, { ...planned, giftTimes: 6 }, 'POST', 409);
      const preview = await ep(previewPath, operator, planned);
      assert.deepEqual([
        preview.originalQuoteCents, preview.cumulativeReceivedCents, preview.deliveredGiftTimes, preview.remainingGiftTimes,
        preview.actualReceivedHearts, preview.originalUnitPriceCents, preview.proposedTotalCents, preview.differenceCents, preview.refundIfDeclinedCents,
      ], [5000, 5000, 95, 5, 190, 50, 5050, 50, 250]);
      const proposal = { ...planned, requestId: randomUUID(), expectedVersion: preview.adjustmentReview.version, reason: '协商剩余五次的单价' };
      await ep(proposalPath, operator, { ...proposal, reason: '  ' }, 'POST', 400);
      await ep(proposalPath, operator, { ...proposal, expectedVersion: '0'.repeat(64) }, 'POST', 409);
      const proposed = await ep(proposalPath, operator, proposal);
      assert.deepEqual(await ep(proposalPath, operator, proposal), proposed);
      const last = workers[1];
      const remaining = {
        requestId: randomUUID(), kind: 'daily', businessDate: window.endDate,
        lines: [{ period: targetPeriod, giftTimes: 5, receivedHearts: 5 }],
      };
      const reportRemaining = (share, status = 201) => ep(reportPath(share, last.account), last.actor, remaining, 'POST', status);
      await reportRemaining(last.shareId, 409);
      await ep(path + '/gift-dispatch/reassign', operator, {
        requestId: randomUUID(), shareId: last.shareId, userId: member.id, giftTimes: 1,
      }, 'POST', 404);
      const respond = { requestId: randomUUID(), adjustmentId: proposed.id, expectedRevision: proposed.revision, decision };
      await cp(decisionPath, outsider, respond, 'POST', 404);
      const actual = await cp(decisionPath, owner, respond);
      assert.equal(actual.decision.source, 'customer');
      assert.equal(actual.supplementReceivedCents, 0);
      assert.equal(actual.netReceivedCents, 5000);
      assert.deepEqual(await cp(decisionPath, owner, respond), actual);
      await cp(decisionPath, owner, { ...respond, requestId: randomUUID(), decision: decision === 'accept' ? 'decline' : 'accept' }, 'POST', 409);
      await reportRemaining(last.shareId, 409);
      const payment = {
        requestId: randomUUID(), adjustmentId: proposed.id, expectedRevision: actual.revision,
        occurredAt: new Date().toISOString(), kind: decision === 'accept' ? 'supplement' : 'refund',
        amountCents: decision === 'accept' ? 50 : 250,
      };
      assert.equal(actual.state, decision === 'accept' ? 'awaiting_supplement' : 'stopped');
      assert.equal(actual.refundDueCents, decision === 'accept' ? 0 : 250);
      assert.equal(actual.refundedCents, 0);
      await ep(proposalPath + '/payments', operator, { ...payment, amountCents: payment.amountCents + 1 }, 'POST', 409);
      let paid;
      if (decision === 'accept') {
        const replayed = await Promise.all([ep(proposalPath + '/payments', operator, payment), ep(proposalPath + '/payments', operator, payment)]);
        [paid] = replayed;
        assert.deepEqual(replayed[1], paid);
      } else {
        const first = await ep(proposalPath + '/payments', operator, { ...payment, amountCents: 100 });
        assert.equal(first.refundedCents, 100);
        const again = { ...payment, requestId: randomUUID(), expectedRevision: first.revision, amountCents: 100 };
        await ep(proposalPath + '/payments', operator, again, 'POST', 409);
        Object.assign(payment, { requestId: randomUUID(), expectedRevision: first.revision, amountCents: 150 });
        paid = await ep(proposalPath + '/payments', operator, payment);
      }
      assert.deepEqual(await ep(proposalPath + '/payments', operator, payment), paid);
      await ep(proposalPath + '/payments', operator, { ...payment, requestId: randomUUID(), expectedRevision: paid.revision }, 'POST', 409);
      if (decision === 'accept') {
        assert.equal(paid.newQuoteSegment, 2);
        assert.equal(paid.supplementReceivedCents, 50);
        const beforeReport = await ep(path + '/fulfillment', operator);
        assert.deepEqual([beforeReport.agreedGiftTimes, beforeReport.deliveredGiftTimes, beforeReport.heartAmountCents], [100, 95, 4750]);
        const moved = beforeReport.segments[1].members.find(item => item.userId === last.actor.id).shares[0];
        const correction = {
          requestId: randomUUID(), expectedVersion: 1, reason: '补记实际补款后同日续送的五次',
          lines: [{ shareId: moved.shareId, quoteSegment: 2, ...remaining.lines[0] }],
        };
        const correctionPath = `${path}/daily-reports/${last.lastReport.originalId}/corrections`;
        await ep(correctionPath, last.actor, correction, 'POST', 409);
        await ep(correctionPath, last.actor, { ...correction, lines: [
          { shareId: last.shareId, quoteSegment: 1, period: 'double', giftTimes: 5, receivedHearts: 10 },
          ...correction.lines,
        ] });
      } else {
        assert.equal(paid.refundedCents, 250);
        await reportRemaining(last.shareId, 409);
      }
      const current = await ep(path + '/fulfillment', operator);
      const { customerServiceCents, dispatchFeeCents, clubFeeCents, memberFeeCents } = current.promotionBasis;
      const ownerView = await read(order);
      assert.equal(ownerView.quote.totalAmountCents, 5000);
      assert.equal(ownerView.receipt.receivedAmountCents, 5000);
      assert.equal(ownerView.deliveryProgress.agreedGiftTimes, 100);
      assert.equal(ownerView.deliveryProgress.priceAdjustment.netReceivedCents, paid.netReceivedCents);
      assert.equal('promotionBasis' in ownerView.deliveryProgress, false);
      assert.deepEqual([current.deliveredGiftTimes, current.actualReceivedHearts, customerServiceCents, dispatchFeeCents, clubFeeCents, memberFeeCents],
        decision === 'accept' ? [100, 195, 5050, 500, 500, 4050] : [95, 190, 4750, 475, 475, 3800]);
    }
  });
  await t.test('晚到的实际履约即时生效，过期改价重新核对，停送退款保留实际退回凭据', async () => {
    const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const order = await publish('client_order', { period: 'normal', paidGiftTimes: 3, dailyGiftTimes: 1, unitPriceCents: 50 },
      { startDate: daysAgo(3), endDate: daysAgo(1) });
    const { shareId } = await claim(order, { dailyGiftTimes: 1 });
    const [personal] = await ep('/employee/songxinhao/linkable', member);
    const accounts = `${order.path}/shares/${shareId}/execution-accounts`;
    const account = await ep(accounts, member, { personalAccountId: personal.id });
    const reports = `${accounts}/${account.id}/daily-reports`;
    const amendments = order.path + '/price-adjustment';
    const responsePath = order.customerPath + '/price-adjustment/decision';
    const action = current => ({ requestId: randomUUID(), adjustmentId: current.id, expectedRevision: current.revision });
    const original = await ep(reports, member, {
      requestId: randomUUID(), kind: 'daily', businessDate: daysAgo(3),
      lines: [{ giftTimes: 1, receivedHearts: 1 }],
    });
    async function proposal(giftTimes) {
      const shift = { quoteSegment: 1, giftTimes, targetPeriod: 'double', targetUnitPriceCents: 60 };
      const preview = await ep(order.path + '/fulfillment/price-preview', operator, shift);
      return { ...shift, expectedVersion: preview.adjustmentReview.version, requestId: randomUUID(), reason: '剩余送心次数改价' };
    }
    const firstInput = await proposal(2);
    const first = await ep(amendments, operator, firstInput);
    await ep(reports, member, {
      requestId: randomUUID(), kind: 'supplement', businessDate: daysAgo(3), reason: '同日已有原日报',
      lines: [{ giftTimes: 1, receivedHearts: 1 }],
    }, 'POST', 409);
    assert.equal((await giftProgress(order)).priceAdjustment.state, 'awaiting_decision');
    const correct = (expectedVersion, giftTimes) => ep(order.path + '/daily-reports/' + original.originalId + '/corrections', member, {
      requestId: randomUUID(), expectedVersion, reason: '核对原来当天的实际次数', lines: [{ giftTimes, receivedHearts: giftTimes }],
    });
    await correct(1, 0);
    const corrected = await giftProgress(order);
    assert.deepEqual([corrected.deliveredGiftTimes, corrected.remainingGiftTimes, corrected.priceAdjustment.state], [0, 3, 'needs_requote']);
    assert.equal(corrected.priceAdjustment.id, first.id);
    assert.equal((await ep(amendments, operator, firstInput)).state, 'needs_requote');
    await cp(responsePath, owner, { ...action(first), decision: 'accept' }, 'POST', 409);
    await ep(reports, member, { requestId: randomUUID(), kind: 'daily', businessDate: daysAgo(2),
      lines: [{ giftTimes: 1, receivedHearts: 1 }] }, 'POST', 409);
    const second = await ep(amendments, operator, await proposal(3));
    const accept = { ...action(second), decision: 'accept' };
    const accepted = await cp(responsePath, owner, accept);
    await correct(2, 1);
    const stale = (await giftProgress(order)).priceAdjustment;
    assert.equal(stale.state, 'needs_requote');
    assert.equal(stale.decision.value, 'accept');
    assert.equal((await cp(responsePath, owner, accept)).decision.value, 'accept');
    await ep(amendments + '/payments', operator, { ...action(accepted), kind: 'supplement', amountCents: 30,
      occurredAt: new Date().toISOString() }, 'POST', 409);
    const recovery = action(stale);
    assert.equal((await ep(amendments + '/resume', operator, recovery)).state, 'superseded');
    assert.equal((await giftProgress(order)).canRequestContinuation, true);
    assert.equal((await ep(amendments + '/resume', operator, recovery)).state, 'superseded');
    const updated = await ep(amendments, operator, await proposal(2));
    const declined = await cp(responsePath, owner, { ...action(updated), decision: 'decline' });
    assert.equal(declined.refundDueCents, 100);
    const refund = { ...action(declined), kind: 'refund', amountCents: 70, occurredAt: new Date().toISOString() };
    const recorded = await ep(amendments + '/payments', operator, refund);
    assert.equal(recorded.payments[0].refundDueAtRecordingCents, 100);
    await ep(reports, member, {
      requestId: randomUUID(), kind: 'supplement', businessDate: daysAgo(2), reason: '确认停送前的实际赠送',
      lines: [{ giftTimes: 1, receivedHearts: 1 }],
    });
    const after = await giftProgress(order);
    assert.equal(after.fulfillmentStatus, 'stopped');
    assert.equal(after.deliveredGiftTimes, 2);
    assert.deepEqual([after.priceAdjustment.originalReceivedCents, after.priceAdjustment.refundDueCents,
      after.priceAdjustment.refundedCents, after.priceAdjustment.netReceivedCents], [150, 50, 70, 80]);
    assert.deepEqual((await ep(amendments + '/payments', operator, refund)).payments, recorded.payments);
    await ep(amendments + '/payments', operator, {
      ...action(after.priceAdjustment), kind: 'refund', amountCents: 1, occurredAt: new Date().toISOString(),
    }, 'POST', 409);
  });
  const order = await publish('direct_dispatch', { period: 'double', paidGiftTimes: 8, dailyGiftTimes: 2, unitPriceCents: 50 },
    { startDate: date[0], endDate: date[3] });
  const continuationOrder = await publish('client_order', { period: 'normal', paidGiftTimes: 2, dailyGiftTimes: 2, unitPriceCents: 50 },
    { startDate: date[0], endDate: date[0] });
  await cp(order.customerPath, outsider, undefined, 'GET', 404);
  await cp(continuationOrder.customerPath, outsider, undefined, 'GET', 404);
  await ep(order.path + '/fulfillment', member, undefined, 'GET', 404);
  const share1 = (await claim(order, { dailyGiftTimes: 1, actualReceivedHearts: 0 })).shareId;
  const share2 = (await claim(order, { dailyGiftTimes: 2 })).shareId;
  const continuationOriginal = (await claim(continuationOrder, { dailyGiftTimes: 2 })).shareId;
  await ep('/employee/songxinhao', member, { name: '仅承接人可见的执行号' });
  const [personal] = await ep('/employee/songxinhao/linkable', member);
  const accounts = (target, shareId) => `${target.path}/shares/${shareId}/execution-accounts`;
  const link = (target, shareId) => ep(accounts(target, shareId), member, { personalAccountId: personal.id });
  const execution = await link(order, share1);
  await link(order, share2);
  const originalAccount = await link(continuationOrder, continuationOriginal);
  const report = (target, shareId, accountId, businessDate, lines, kind = 'daily') => ep(
    `${accounts(target, shareId)}/${accountId}/daily-reports`, member,
    { requestId: randomUUID(), businessDate, lines, kind, ...(kind === 'supplement' ? { reason: '照记录补报' } : {}) },
  );
  const dayOne = await report(order, share1, execution.id, date[0], [{ giftTimes: 2, receivedHearts: null }]);
  await report(order, share1, execution.id, date[1], [{ giftTimes: 0, receivedHearts: 0 }]);
  const supervision = through => ep(`${order.path}/fulfillment?through=${through}`, operator);
  const past = await supervision(date[1]);
  const [person] = past.segments[0].members;
  assert.deepEqual(person.days.map(day => day.status), ['on_track', 'reported_zero', 'future', 'future']);
  assert.deepEqual(person.shares.find(share => share.shareId === share2).days.map(day => day.status), ['missing', 'missing', 'future', 'future']);
  const queue = `${employee}/orders/fulfillment-exceptions?through=${date[0]}`;
  const queueItems = (await ep(queue, operator)).items;
  const queued = queueItems.find(item => item.order.id === order.id);
  assert.deepEqual(queued.fulfillment.segments[0].members[0].shares.map(share => share.shareId), [share2]);
  const unreported = queueItems.find(item => item.order.id === continuationOrder.id);
  assert.equal(unreported.fulfillment.segments[0].members[0].shares[0].days[0].status, 'missing');
  assert.deepEqual((await ep(queue, member)).items, []);
  await ep(`${order.path}/fulfillment?through=2026-02-30`, operator, undefined, 'GET', 400);
  assert.deepEqual(await giftProgress(order), {
    priceUnit: 'gift_times', agreedGiftTimes: 8, deliveredGiftTimes: 2, remainingGiftTimes: 6, actualReceivedHearts: null,
    estimatedReceivedHearts: 16, claimObservedReceivedHearts: [0], unknownClaimObservations: 1,
    knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, closedAt: null, fulfillmentStatus: 'in_progress', canRequestContinuation: true,
    observedGiftTimes: 2, excessGiftTimes: 0, estimatedDeliveredHearts: 4, heartAmountCents: 100, periodOnlyDifferenceCents: 0,
    periods: [{ period: 'double', observedGiftTimes: 2, deliveredGiftTimes: 2, estimatedDeliveredHearts: 4,
      actualReceivedHearts: null, knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, heartAmountCents: 100 }],
    segments: [{
      segmentIndex: 0, period: 'double', paidGiftTimes: 8, dailyGiftTimes: 2, unitPriceCents: 50, agreedGiftTimes: 8,
      deliveredGiftTimes: 2, remainingGiftTimes: 6, actualReceivedHearts: null, estimatedReceivedHearts: 16,
      knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, claimObservedReceivedHearts: [0], unknownClaimObservations: 1,
      observedGiftTimes: 2, excessGiftTimes: 0, estimatedDeliveredHearts: 4, heartAmountCents: 100,
      periods: [{ period: 'double', observedGiftTimes: 2, deliveredGiftTimes: 2, estimatedDeliveredHearts: 4,
        actualReceivedHearts: null, knownReceivedHearts: 0, knownReceivedLines: 1, unknownReceivedLines: 1, heartAmountCents: 100 }],
      window: { startDate: date[0], endDate: date[3] },
    }],
  });
  const correction = { requestId: randomUUID(), expectedVersion: 1, reason: '按份额补充已送记录', lines: [
    { giftTimes: 1, receivedHearts: 0 }, { shareId: share2, giftTimes: 1, receivedHearts: 0 },
  ] };
  const correctPath = `${order.path}/daily-reports/${dayOne.originalId}/corrections`;
  await ep(correctPath, member, correction);
  assert.equal((await giftProgress(order)).actualReceivedHearts, 0);
  assert.equal((await ep(queue, operator)).items.some(item => item.order.id === order.id), false);
  await report(order, share1, execution.id, date[2], [{ giftTimes: 1, receivedHearts: 1 }]);
  assert.equal((await supervision(date[2])).segments[0].members[0].days[2].status, 'short');
  await report(order, share1, execution.id, date[3], [{ giftTimes: 1, receivedHearts: 2 }], 'supplement');
  assert.equal((await supervision(date[1])).deliveredGiftTimes, 2);
  assert.equal((await giftProgress(order)).deliveredGiftTimes, 4);
  const transfer = (shareId, giftTimes) => ep(order.path + '/gift-dispatch/reassign', operator,
    { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes });
  await transfer(share1, 1);
  await transfer(share2);
  const afterTransfer = (await supervision(date[3])).segments[0];
  const transferred = afterTransfer.members[0].shares.find(share => share.shareId === share2);
  assert.equal(transferred.agreedGiftTimes, 1);
  assert.equal(transferred.window.endDate, date[0]);
  assert.deepEqual(transferred.days.map(day => day.status), ['on_track']);
  const publicView = await read(order);
  for (const privateValue of [member.id, execution.id, '仅承接人可见的执行号', 'dispatchFeeCents', 'clubFeeCents', 'memberCents'])
    assert.equal(JSON.stringify(publicView).includes(privateValue), false);
  assert.equal((await cp('/client/orders', owner)).items.find(item => item.id === order.id).deliveryProgress.remainingGiftTimes, 4);

  await t.test('按实际游戏时段核对混合报价、单段跨期、转派和日报更正', async () => {
    const quoteWindow = { startDate: date[0], endDate: date[3] };
    const mixed = await publish('client_order', [
      { period: 'double', paidGiftTimes: 60, dailyGiftTimes: 15, unitPriceCents: 50 },
      { period: 'normal', paidGiftTimes: 40, dailyGiftTimes: 10, unitPriceCents: 50 },
    ], quoteWindow);
    const mixInitial = await read(mixed);
    assert.equal(mixInitial.deliveryProgress.estimatedReceivedHearts, 160);
    assert.equal(mixInitial.quote.heartsAmountCents, 5000);
    const shares = await Promise.all([0, 1].map(segmentIndex =>
      claim(mixed, { segmentIndex, dailyGiftTimes: 2 })));
    const mixedAccount = await link(mixed, shares[0].shareId);
    assert.equal((await link(mixed, shares[1].shareId)).id, mixedAccount.id);
    await report(mixed, shares[0].shareId, mixedAccount.id, date[0], [
      { shareId: shares[0].shareId, period: 'double', giftTimes: 2, receivedHearts: 4 },
      { shareId: shares[1].shareId, period: 'normal', giftTimes: 2, receivedHearts: 2 },
    ]);
    const mixedProgress = await giftProgress(mixed);
    assert.deepEqual([mixedProgress.deliveredGiftTimes, mixedProgress.actualReceivedHearts, mixedProgress.remainingGiftTimes], [4, 6, 96]);
    assert.deepEqual(mixedProgress.periods.map(({ period, deliveredGiftTimes, actualReceivedHearts }) =>
      [period, deliveredGiftTimes, actualReceivedHearts]), [['normal', 2, 2], ['double', 2, 4]]);

    const crossing = await publish('direct_dispatch', { period: 'normal', paidGiftTimes: 5, dailyGiftTimes: 5, unitPriceCents: 50 },
      { startDate: date[0], endDate: date[0] });
    const initial = await read(crossing);
    const { shareId } = await claim(crossing, { dailyGiftTimes: 5, actualReceivedHearts: 9 });
    const account = await link(crossing, shareId);
    const original = await report(crossing, shareId, account.id, date[0], [
      { period: 'normal', giftTimes: 2, receivedHearts: 2 },
      { period: 'double', giftTimes: 2, receivedHearts: 4 },
    ]);
    const supervisionPath = crossing.path + '/fulfillment';
    const inspect = () => ep(`${supervisionPath}?through=${date[0]}`, operator);
    const memberProgress = async () => (await ep(crossing.path + '/daily-reports', member)).giftProgress;
    const sameDay = await inspect();
    assert.equal(sameDay.segments[0].period, 'normal');
    assert.equal(sameDay.segments[0].members[0].shares[0].days[0].reportedGiftTimes, 4);
    assert.deepEqual(sameDay.periods, (await memberProgress()).segments[0].periods);
    assert.deepEqual([sameDay.deliveredGiftTimes, sameDay.actualReceivedHearts, sameDay.estimatedDeliveredHearts], [4, 6, 6]);
    assert.deepEqual(sameDay.claimObservedReceivedHearts, [9]);
    await ep(crossing.path + '/gift-dispatch/reassign', operator,
      { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes: 2 }, 'POST', 409);
    await ep(crossing.path + '/gift-dispatch/reassign', operator,
      { requestId: randomUUID(), shareId, userId: substitute.id, giftTimes: 1 });
    const correctionPath = `${crossing.path}/daily-reports/${original.originalId}/corrections`;
    const correct = (expectedVersion, lines) => ep(correctionPath, member,
      { requestId: randomUUID(), expectedVersion, reason: '复核实际游戏时段和到账', lines });
    await correct(1, [{ period: 'double', giftTimes: 4, receivedHearts: 8 }]);
    const allDouble = await memberProgress();
    assert.deepEqual(allDouble.pendingCompensation, { giftTimes: 4, grossCents: 200, dispatchFeeCents: 20, clubFeeCents: 20, memberCents: 160 });
    assert.deepEqual([allDouble.estimatedReceivedHearts, allDouble.estimatedDeliveredHearts, allDouble.actualReceivedHearts, allDouble.remainingGiftTimes], [5, 8, 8, 0]);
    const unchanged = await read(crossing);
    assert.deepEqual(unchanged.quote, initial.quote);
    assert.deepEqual(unchanged.receipt, initial.receipt);
    assert.equal(unchanged.deliveryProgress.periodOnlyDifferenceCents, 0);
    assert.equal((await inspect()).remainingGiftTimes, 1);

    await correct(2, [{ period: 'double', giftTimes: 3, receivedHearts: 0 }, { period: 'unconfirmed', giftTimes: 1, receivedHearts: null }]);
    const uncertain = await giftProgress(crossing);
    assert.deepEqual([uncertain.estimatedDeliveredHearts, uncertain.actualReceivedHearts, uncertain.unknownReceivedLines], [null, null, 1]);
    assert.deepEqual(uncertain.periods.map(({ period, actualReceivedHearts, estimatedDeliveredHearts, knownReceivedLines }) =>
      [period, actualReceivedHearts, estimatedDeliveredHearts, knownReceivedLines]), [['double', 0, 6, 1], ['unconfirmed', null, null, 0]]);
    await correct(3, [{ period: 'normal', giftTimes: 2, receivedHearts: 2 }, { period: 'double', giftTimes: 3, receivedHearts: 6 }]);
    const excessive = await inspect();
    assert.deepEqual([excessive.observedGiftTimes, excessive.deliveredGiftTimes, excessive.excessGiftTimes, excessive.actualReceivedHearts, excessive.heartAmountCents], [5, 4, 1, 8, 200]);
    assert.deepEqual(excessive.periods.map(row => [row.period, row.deliveredGiftTimes, row.heartAmountCents]),
      [['normal', null, null], ['double', null, null]]);

    const tail = await publish('direct_dispatch', { period: 'normal', paidGiftTimes: 1, dailyGiftTimes: 1, unitPriceCents: 50 },
      { startDate: date[0], endDate: date[0] });
    const tailShare = (await claim(tail, { dailyGiftTimes: 1 })).shareId;
    const tailAccount = await link(tail, tailShare);
    await report(tail, tailShare, tailAccount.id, date[0], [{ period: 'double', giftTimes: 1, receivedHearts: 2 }]);
    const last = await giftProgress(tail);
    assert.deepEqual([last.deliveredGiftTimes, last.remainingGiftTimes, last.actualReceivedHearts, last.heartAmountCents, last.periodOnlyDifferenceCents], [1, 0, 2, 50, 0]);
  });

  await report(continuationOrder, continuationOriginal, originalAccount.id, date[0], [{ giftTimes: 2, receivedHearts: 2 }]);
  const completed = await giftProgress(continuationOrder);
  assert.equal(completed.fulfillmentStatus, 'completed');
  assert.equal(completed.closedAt, null);
  assert.equal(completed.canRequestContinuation, true);
  await rule(1, 7);
  const { customerPath, path } = continuationOrder;
  const requested = { requestId: randomUUID(), period: 'double', paidGiftTimes: 5, dailyGiftTimes: 3,
    startDate: date[2], endDate: date[3] };
  await cp(customerPath + '/continuation-requests', outsider, requested, 'POST', 404);
  await cp(customerPath + '/continuation-requests', owner, { ...requested, unitPriceCents: 1 }, 'POST', 400);
  const request = await cp(customerPath + '/continuation-requests', owner, requested);
  assert.deepEqual(await cp(customerPath + '/continuation-requests', owner, requested), request);
  const quotation = { requestId: randomUUID(), customerRequestId: request.requestId,
    segment: { period: 'double', paidGiftTimes: 5, dailyGiftTimes: 3, unitPriceCents: 65 } };
  await ep(path + '/continuation-quotes', member, quotation, 'POST', 404);
  const quote = await ep(path + '/continuation-quotes', operator, quotation);
  assert.deepEqual(quote.commission, { version: 1, basis: 'gift_times', dispatchFeeCents: 5, clubFeeCents: 5 });
  const quotePath = `/continuation-quotes/${quote.requestId}`;
  const acceptance = { requestId: randomUUID() };
  await cp(customerPath + quotePath + '/acceptance', outsider, acceptance, 'POST', 404);
  await cp(customerPath + quotePath + '/acceptance', owner, { ...acceptance, unitPriceCents: 1 }, 'POST', 400);
  await cp(customerPath + quotePath + '/acceptance', owner, acceptance);
  assert.equal((await giftProgress(continuationOrder)).agreedGiftTimes, 2);
  assert.equal((await read(continuationOrder)).continuationQuotes[0].receipt, undefined);
  assert.equal((await ep(path + '/gift-dispatch', operator)).quotes.length, 1);
  const receipt = { requestId: randomUUID(), receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00Z' };
  await ep(path + quotePath + '/receipt', operator, { ...receipt, receivedAmountCents: 324 }, 'POST', 409);
  const paid = () => ep(path + quotePath + '/receipt', operator, receipt);
  assert.deepEqual(await Promise.all([paid(), paid()]), [
    { receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00.000Z', segmentIndex: 1 },
    { receivedAmountCents: 325, receivedAt: '2026-11-22T09:00:00.000Z', segmentIndex: 1 },
  ]);
  const extended = await read(continuationOrder);
  assert.equal(extended.quote.totalAmountCents, 100);
  assert.equal(extended.continuationQuotes[0].receipt.receivedAmountCents, 325);
  assert.deepEqual(extended.deliveryProgress.segments.map(segment => segment.unitPriceCents), [50, 65]);
  assert.equal(extended.deliveryProgress.agreedGiftTimes, 7);
  assert.equal(extended.deliveryProgress.remainingGiftTimes, 5);
  const segment = { segmentIndex: 1, startDate: date[2], endDate: date[3], openToClaim: true, directed: [] };
  await ep(path + '/gift-dispatch', operator, { requestId: randomUUID(), segments: [{ ...segment, startDate: date[1] }] }, 'POST', 400);
  await ep(path + '/gift-dispatch', operator, { requestId: randomUUID(), segments: [segment] });
  const second = await claim(continuationOrder, { segmentIndex: 1, dailyGiftTimes: 3 });
  const secondAccount = await link(continuationOrder, second.shareId);
  await report(continuationOrder, second.shareId, secondAccount.id, date[2], [{ period: 'double', giftTimes: 3, receivedHearts: 5 }]);
  assert.equal((await giftProgress(continuationOrder)).remainingGiftTimes, 2);
  assert.equal((await giftProgress(continuationOrder)).segments[1].periods[0].heartAmountCents, 195);
  assert.equal((await ep(path + '/daily-reports', member)).giftProgress.pendingCompensation.memberCents, 245);

  const orders = db.collection('club_orders');
  const closedAt = new Date('2026-11-24T00:00:00Z');
  await orders.updateOne({ _id: objectId(continuationOrder.id) }, { $set: { closedAt } });
  assert.equal((await giftProgress(continuationOrder)).closedAt, closedAt.toISOString());
  await cp(customerPath + '/continuation-requests', owner, { ...requested, requestId: randomUUID() }, 'POST', 409);
  assert.deepEqual(await cp(customerPath + '/continuation-requests', owner, requested), request);
  assert.equal((await paid()).segmentIndex, 1);
  await orders.updateOne({ _id: objectId(order.id) }, { $set: { closedAt } });
  await ep(correctPath, member, { ...correction, requestId: randomUUID(), expectedVersion: 2 }, 'POST', 409);
  assert.equal((await ep(correctPath, member, correction)).version, 2);
  assert.equal((await ep(order.path + '/daily-reports', member)).giftProgress.canCorrectReports, false);

  const historical = objectId();
  const historicalShare = objectId();
  await orders.insertOne({ _id: historical, clubId: 'club', source: 'direct_dispatch', businessType: 'heart_delivery',
    requestId: randomUUID(), createdByUserId: operator.id, dispatcherUserId: operator.id,
    customerUserId: owner.id, customerLinkStatus: 'verified', dispatchStatus: 'published', recipientGameAccount: '历史老板',
    heartDelivery: { requestedHearts: 20, agreedDeadline: date[3] },
    shares: [{ _id: historicalShare, userId: member.id, hearts: 12, executionGameAccounts: [] }],
  });
  await db.collection('club_daily_reports').insertOne({ orderId: historical, shareId: historicalShare, userId: member.id,
    requestId: randomUUID(), accountId: objectId(), originalId: objectId(), version: 1, businessDate: date[0], kind: 'daily',
    receivedHearts: 11, lines: [{ giftTimes: 2, receivedHearts: 11, period: 'double' }],
  });
  const historicalView = await cp(`${client}/${historical}`, owner);
  assert.equal(historicalView.requestedGiftTimes, undefined);
  assert.equal(historicalView.requestedHearts, 20);
  assert.equal(historicalView.deliveryProgress.agreedDeadline, date[3]);
  assert.equal((await ep(`${employee}/orders/${historical}/fulfillment`, operator)).agreedDeadline, date[3]);
  assert.deepEqual([historicalView.deliveryProgress.observedHearts, historicalView.deliveryProgress.creditedHearts,
    historicalView.deliveryProgress.remainingHearts], [11, 11, 9]);
  await cp(`${client}/${historical}`, outsider, undefined, 'GET', 404);
});
