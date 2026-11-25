import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const objectId = value => new mongoose.Types.ObjectId(value);
const firstDay = '2026-11-25';

test('按次日报、补报与更正立即影响履约和本人待结依据，旧按颗报告按原状态读取', { timeout: 120000 }, async t => {
  const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.diary.test`]));
  const { db, base, password, seedClub, startPeer } = await startSystem(t, {
    database: 'club_delivery_e2e', origins, adminUsername: 'diary_admin',
    extraFixtures: `
      const { Collection } = require('mongoose').mongo;
      const insertOne = Collection.prototype.insertOne;
      Collection.prototype.insertOne = async function (doc, ...args) {
        const result = await insertOne.call(this, doc, ...args);
        if (this.collectionName === 'club_daily_reports' && doc.reason === '模拟日报回执中断')
          throw new Error('测试：日报已写入，服务未收取成功回执');
        return result;
      };
    `,
  });
  async function call(app, path, { method = 'GET', token, body, status = 200, cookie, server = base } = {}) {
    const headers = { origin: origins[app] };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(server + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.ok([status].flat().includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
    return { data: payload.data, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  }
  async function login(app, username) {
    const { cookie } = await call(app, `/captcha/login?app=${app}`);
    return (await call(app, '/user/login?type=account', {
      method: 'POST', cookie, body: { app, username, password, captcha: captchaCode }, status: 201,
    })).data;
  }
  const get = async (actor, path, status = 200) => (await call('employee', path, { token: actor.token, status })).data;
  const post = async (actor, path, body, status = 201, server) =>
    (await call('employee', path, { method: 'POST', token: actor.token, body, status, server })).data;
  const admin = await login('admin', 'diary_admin');
  const dispatcher = await login('employee', 'diary_admin');
  const club = '/employee/club';
  await seedClub('name', '日报俱乐部');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('grant', admin.id, 'CLUB_COMMISSION_MANAGE');
  await call('admin', '/admin/club/commission-rule', {
    method: 'PATCH', token: admin.token, body: { expectedVersion: 0, basis: 'gift_times', clubFeeCents: 5 },
  });
  async function invite(username) {
    const { invitationUrl } = await post(dispatcher, `${club}/member-invitations`);
    const invitation = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('token');
    await call('client', '/client/club-invitations/register', {
      method: 'POST', body: { token: invitation, username, password }, status: 201,
    });
    return login('employee', username);
  }
  const member = await invite('diary_member');
  const other = await invite('diary_other');
  const registration = await call('client', '/captcha/register?app=client');
  const { data: customer } = await call('client', '/user/register?type=account', {
    method: 'POST', cookie: registration.cookie,
    body: { app: 'client', username: 'diary_customer', password, captcha: captchaCode }, status: 201,
  });
  const client = await login('client', 'diary_customer');

  const double = { period: 'double', paidGiftTimes: 5, dailyGiftTimes: 5, unitPriceCents: 50 };
  const normal = { period: 'normal', paidGiftTimes: 4, dailyGiftTimes: 4, unitPriceCents: 75 };
  async function create(giftSegments) {
    const order = await post(dispatcher, `${club}/orders`, {
      requestId: randomUUID(), existingCustomerUserId: customer.id, recipientGameAccount: '老板 · 云海',
      requestedGiftTimes: giftSegments.reduce((sum, segment) => sum + segment.paidGiftTimes, 0),
      estimatedReceivedHearts: giftSegments.reduce((sum, segment) => sum + segment.paidGiftTimes * (segment.period === 'double' ? 2 : 1), 0),
    });
    const path = `${club}/orders/${order.id}`;
    const { data: pricing } = await call('employee', `${path}/pricing`, {
      method: 'PATCH', token: dispatcher.token,
      body: { ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 5, giftSegments },
    });
    await post(dispatcher, `${path}/receipts`, {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: pricing.quote.totalAmountCents, receivedAt: '2026-11-24T08:00:00Z',
    });
    await post(dispatcher, `${path}/publish`, {
      requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: giftSegments.map((_, segmentIndex) => ({ segmentIndex, startDate: firstDay,
        endDate: firstDay, openToClaim: true, directed: [] })),
    });
    const shares = [];
    for (const [segmentIndex, segment] of giftSegments.entries()) {
      const result = await post(member, `${club}/gift-claims/${order.id}`, {
        requestId: randomUUID(), kind: 'public', segmentIndex, dailyGiftTimes: segment.dailyGiftTimes,
      });
      shares.push(result.shareId);
    }
    return { order, path, shares };
  }
  const { order, path, shares: [firstShare, secondShare] } = await create([double, normal]);
  for (const name of ['号甲', '号乙']) await post(member, '/employee/songxinhao', { name });
  const personal = await get(member, '/employee/songxinhao/linkable');
  const firstPersonal = personal.find(item => item.name === '号甲');
  const secondPersonal = personal.find(item => item.name === '号乙');
  const link = (targetPath, shareId, personalAccountId) =>
    post(member, `${targetPath}/shares/${shareId}/execution-accounts`, { personalAccountId });
  const game = await link(path, firstShare, firstPersonal.id);
  assert.equal((await link(path, secondShare, firstPersonal.id)).id, game.id);
  const game2 = await link(path, secondShare, secondPersonal.id);
  assert.notEqual(game.id, game2.id);
  const reportPath = (shareId, accountId, targetPath = path) =>
    `${targetPath}/shares/${shareId}/execution-accounts/${accountId}/daily-reports`;
  const daily = (businessDate, lines) => ({ requestId: randomUUID(), kind: 'daily', businessDate, lines });
  const historyPath = `${path}/daily-reports`;
  const progress = async () => (await get(member, historyPath)).giftProgress;
  const start = daily(firstDay, [{ giftTimes: 4, receivedHearts: null }]);
  await post(dispatcher, reportPath(firstShare, game.id), start, 404);
  await post(other, reportPath(firstShare, game.id), start, 404);
  await post(member, reportPath(firstShare, game2.id), start, 404);
  await post(member, reportPath(secondShare, game2.id), { ...start, lines: [{ ...start.lines[0], shareId: firstShare }] }, 404);
  await post(member, reportPath(firstShare, game.id).replace('/employee/club/', '/employee/clubs/other/'), start, 404);
  await post(member, reportPath(firstShare, game.id), { ...start, businessDate: '2026-02-30' }, 400);
  await call('client', historyPath, { token: client.token, status: 403 });
  const [original, replay] = await Promise.all([post(member, reportPath(firstShare, game.id), start), post(member, reportPath(firstShare, game.id), start)]);
  assert.deepEqual(original, replay);
  assert.equal(original.priceUnit, 'gift_times');
  assert.equal(original.orderId, order.id);
  assert.equal(original.status, 'recorded');
  assert.equal(original.receivedHearts, null);
  assert.equal(original.accountName, '号甲');
  assert.equal(original.recipientGameAccount, '老板 · 云海');
  assert.deepEqual(original.lines, [{ shareId: firstShare, quoteSegment: 1, period: 'double', giftTimes: 4, receivedHearts: null }]);
  assert.ok(Number.isFinite(Date.parse(original.submittedAt)));
  await post(member, reportPath(secondShare, game.id), { ...start, requestId: randomUUID() }, 409);
  await post(member, reportPath(firstShare, game.id), { ...start, lines: [{ giftTimes: 2, receivedHearts: null }] }, 409);

  const initial = await progress();
  assert.equal(initial.deliveredGiftTimes, 4);
  assert.equal(initial.remainingGiftTimes, 5);
  assert.equal(initial.estimatedDeliveredHearts, 8);
  assert.equal(initial.estimatedReceivedHearts, 14);
  assert.equal(initial.actualReceivedHearts, null);
  assert.equal(initial.unknownReceivedLines, 1);
  assert.equal(initial.pendingCompensation.memberCents, 160);
  assert.equal(initial.shares.find(share => share.shareId === firstShare).remainingGiftTimes, 1);

  const reports = db.collection('club_daily_reports');
  const orders = db.collection('club_orders');
  const activeOrderId = objectId(order.id);
  const originalSelector = { _id: objectId(original.id) };
  // A published order from before the explicit unit used only its known gift share as the header.
  await reports.updateOne(originalSelector, { $unset: { priceUnit: '', 'lines.$[].shareId': '' } });
  assert.deepEqual(await progress(), initial);
  assert.equal((await get(member, historyPath)).items[0].priceUnit, 'gift_times');
  const correctionPath = `${historyPath}/${original.originalId}/corrections`;
  const correct = { requestId: randomUUID(), expectedVersion: 1, reason: '游戏记录确认实际未到账', lines: [{ giftTimes: 4, receivedHearts: 0 }] };
  await post(other, correctionPath, correct, 404);
  await post(dispatcher, correctionPath, correct, 404);
  const amended = await post(member, correctionPath, correct);
  assert.equal(amended.status, 'recorded');
  assert.equal(amended.previous.receivedHearts, null);
  assert.equal(amended.receivedHearts, 0);
  assert.equal(amended.previous.userId, member.id);
  assert.equal(amended.previous.submittedAt, original.submittedAt);
  assert.equal(amended.reason, correct.reason);
  assert.equal((await progress()).actualReceivedHearts, 0);
  const race = await Promise.all([4, 4].map(times => post(member, correctionPath, {
    ...correct, requestId: randomUUID(), expectedVersion: 2, lines: [{ giftTimes: times, receivedHearts: 0 }],
  }, [201, 409])));
  assert.equal(race.filter(Boolean).length, 1);
  assert.equal(race.find(Boolean).version, 3);

  const late = { ...daily('2026-11-24', [
    { shareId: firstShare, giftTimes: 1, receivedHearts: 1, period: 'normal' },
    { shareId: secondShare, giftTimes: 2, receivedHearts: null },
  ]), kind: 'supplement', reason: '昨天漏填' };
  await post(member, reportPath(secondShare, game.id), { ...late, reason: '' }, 400);
  const filed = await post(member, reportPath(firstShare, game.id), late);
  assert.equal(filed.status, 'recorded');
  assert.equal(filed.lines[1].quoteSegment, 2);
  const supplementary = await progress();
  assert.equal(supplementary.deliveredGiftTimes, 7);
  assert.equal(supplementary.remainingGiftTimes, 2);
  assert.equal(supplementary.actualReceivedHearts, null);
  assert.equal(supplementary.knownReceivedHearts, 1);
  assert.deepEqual(supplementary.pendingCompensation, { giftTimes: 7, grossCents: 400, dispatchFeeCents: 35, clubFeeCents: 35, memberCents: 330 });
  assert.deepEqual((await get(dispatcher, `${path}/gift-dispatch`)).segments.map(segment => segment.shares[0].deliveredGiftTimes), [5, 2]);
  await post(dispatcher, `${path}/gift-dispatch/reassign`, {
    requestId: randomUUID(), shareId: secondShare, userId: other.id, giftTimes: 3,
  }, 409);
  await get(dispatcher, historyPath, 404);

  const excess = { ...daily(firstDay, [{ giftTimes: 3, receivedHearts: 3 }]), reason: '模拟日报回执中断' };
  await post(member, reportPath(secondShare, game2.id), excess, 500);
  assert.equal(await reports.countDocuments({ orderId: activeOrderId, requestId: excess.requestId }), 1);
  const staged = await orders.findOne({ _id: activeOrderId });
  assert.equal(staged.pendingDailyReport.requestId, excess.requestId);
  const peer = await startPeer();
  const confirmed = await post(member, reportPath(secondShare, game2.id), excess, 201, peer);
  assert.equal(confirmed.receivedHearts, 3);
  assert.equal((await orders.findOne({ _id: activeOrderId })).pendingDailyReport, undefined);
  const completed = await progress();
  assert.equal(completed.observedGiftTimes, 10);
  assert.equal(completed.deliveredGiftTimes, 9);
  assert.equal(completed.orderRemainingGiftTimes, 0);
  assert.equal(completed.excessGiftTimes, 1);
  assert.equal(completed.pendingCompensation.memberCents, 460);
  assert.deepEqual((await orders.findOne({ _id: activeOrderId })).receipt, staged.receipt);
  const sameDay = daily('2026-11-22', [{ giftTimes: 0, receivedHearts: 0 }]);
  const concurrentDay = await Promise.all([sameDay, { ...sameDay, requestId: randomUUID() }].map(input =>
    post(member, reportPath(secondShare, game2.id), input, [201, 409]),
  ));
  assert.equal(concurrentDay.filter(Boolean).length, 1);
  assert.equal(await reports.countDocuments({ orderId: activeOrderId, accountId: objectId(game2.id), businessDate: sameDay.businessDate }), 1);

  const { path: racePath, shares: [raceShare] } = await create([double]);
  const raceAccount = await link(racePath, raceShare, secondPersonal.id);
  const [sent, reassigned] = await Promise.all([
    post(member, reportPath(raceShare, raceAccount.id, racePath), daily(firstDay, [{ giftTimes: 3, receivedHearts: null }])),
    post(dispatcher, `${racePath}/gift-dispatch/reassign`, {
      requestId: randomUUID(), shareId: raceShare, userId: other.id, giftTimes: 4,
    }, [201, 409]),
  ]);
  assert.equal(sent.giftTimes, 3);
  const raceProgress = (await get(member, `${racePath}/daily-reports`)).giftProgress;
  assert.equal(raceProgress.deliveredGiftTimes, reassigned ? 1 : 3);
  assert.equal(raceProgress.excessGiftTimes, reassigned ? 2 : 0);
  assert.ok(raceProgress.deliveredGiftTimes + (reassigned?.giftTimes ?? 0) <= 5);

  await call('employee', `/employee/songxinhao/${firstPersonal.localId}`, { method: 'DELETE', token: member.token });
  await orders.updateOne({ _id: activeOrderId }, { $set: { dispatchWithdrawnAt: new Date() } });
  await post(member, reportPath(firstShare, game.id), daily('2026-11-26', [{ giftTimes: 0, receivedHearts: 0 }]), 409);
  const afterWithdrawal = await post(member, reportPath(firstShare, game.id), {
    ...daily('2026-11-23', [{ giftTimes: 0, receivedHearts: 0 }]), kind: 'supplement', reason: '撤回前漏填',
  });
  assert.equal(afterWithdrawal.status, 'recorded');
  const afterRemoval = await post(member, correctionPath, { ...correct, requestId: randomUUID(), expectedVersion: 3 });
  assert.equal(afterRemoval.accountName, '号甲');
  assert.equal(afterRemoval.accountLocalId, firstPersonal.localId);
  assert.equal(afterRemoval.personalAccountId, firstPersonal.id);

  const legacyOrderId = objectId();
  const legacyShareId = objectId();
  const legacyAccountId = objectId();
  const legacyRootId = objectId();
  await orders.insertOne({
    _id: legacyOrderId, clubId: 'club', source: 'direct_dispatch', requestId: randomUUID(), createdByUserId: dispatcher.id,
    dispatcherUserId: dispatcher.id, recipientGameAccount: '旧游戏号', customerLinkStatus: 'verified',
    dispatchStatus: 'published', heartDelivery: { requestedHearts: 4 },
    dispatchPricing: { version: 1, basis: 'received_hearts' },
    shares: [{ _id: legacyShareId, userId: member.id, hearts: 4 }],
  });
  const historical = {
    orderId: legacyOrderId, userId: member.id, shareId: legacyShareId, originalId: legacyRootId,
    accountId: legacyAccountId, accountName: '旧执行号', recipientGameAccount: '旧游戏号',
    businessDate: firstDay, submittedAt: new Date(), requestHash: 'saved_legacy',
  };
  await reports.insertMany([
    { ...historical, _id: legacyRootId, requestId: randomUUID(), kind: 'daily', version: 1,
      receivedHearts: 2, lines: [{ period: 'double', quoteSegment: 1, giftTimes: 1, receivedHearts: 2 }] },
    { ...historical, _id: objectId(), requestId: randomUUID(), kind: 'correction', version: 2, reason: '旧更正留待核对',
      receivedHearts: 4, lines: [{ period: 'double', quoteSegment: 1, giftTimes: 2, receivedHearts: 4 }] },
  ]);
  const legacy = await get(member, `${club}/orders/${legacyOrderId}/daily-reports`);
  assert.equal(legacy.priceUnit, 'received_hearts');
  assert.equal(legacy.giftProgress, undefined);
  assert.equal(legacy.items.find(item => item.version === 1).status, 'recorded');
  const legacyCorrection = legacy.items.find(item => item.version === 2);
  assert.equal(legacyCorrection.status, 'pending_review');
  assert.equal(legacyCorrection.previous.receivedHearts, 2);
  assert.equal(legacyCorrection.receivedHearts, 4);
});
