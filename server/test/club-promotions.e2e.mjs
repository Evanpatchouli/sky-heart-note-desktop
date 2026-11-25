import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { giftServiceAmounts } from '@webapp-template/common';
import { startSystem, captchaCode } from './start-system.mjs';

const club = 'promotion';
const employee = '/employee/clubs/' + club;
const client = '/client/clubs/' + club;
const admin = '/admin/clubs/' + club;
const receivedAt = '2026-11-20T00:00:00.000Z';
const segment = (paidGiftTimes, unitPriceCents = 50, period = 'normal') =>
  ({ period, paidGiftTimes, dailyGiftTimes: paidGiftTimes, unitPriceCents });
const withGift = (paidGiftTimes, promotionalGiftTimes, unitPriceCents, period) =>
  ({ ...segment(paidGiftTimes, unitPriceCents, period), promotionalGiftTimes });
const window = date => ({ startDate: date, endDate: date });

test('按次优惠、固定解锁费、客户优惠券和促销赠送的 HTTP 与 Mongo 回归', { timeout: 150_000 }, async t => {
  const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.promotion.test`]));
  const { base, password, runCommand, startPeer } = await startSystem(t, { database: 'promotion_e2e', adminUsername: 'promo_admin', origins });
  const challenges = new Map();
  async function call(app, path, actor, body, method = body === undefined ? 'GET' : 'POST', status = method === 'POST' ? 201 : 200, server = base) {
    const headers = { origin: origins[app] };
    if (actor?.token) headers.authorization = `Bearer ${actor.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (path.startsWith('/user/') && challenges.has(app)) headers.cookie = challenges.get(app);
    const response = await fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.ok([status].flat().includes(response.status), `${method} ${path} ${response.status} ${JSON.stringify(result)}`);
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
  async function register(username) {
    await call('client', '/captcha/register?app=client');
    await call('client', '/user/register?type=account', null, { app: 'client', username, password, captcha: captchaCode });
    return login('client', username);
  }
  const dispatcher = await login('employee', 'promo_admin');
  const manager = await login('admin', 'promo_admin');
  const customer = await register('promo_customer');
  const outsider = await register('promo_outsider');
  const ep = (path, body, method, status, server) => call('employee', path, dispatcher, body, method, status, server);
  const cp = (path, body, method, status, actor = customer) => call('client', path, actor, body, method, status);
  const ap = (path, body, method, status) => call('admin', path, manager, body, method, status);
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);
  await configure('club', club, '测试俱乐部');
  await configure('member', club, dispatcher.id, 'active', 'dispatcher');
  await configure('grant', club, dispatcher.id, 'CLUB_COMMISSION_MANAGE');
  await configure('club', 'foreign', '另一个俱乐部');
  await ap(admin + '/commission-rule', { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  await ap('/admin/clubs/foreign/promotions', undefined, 'GET', 403);
  await call('employee', admin + '/promotions', dispatcher, undefined, 'GET', 403);

  const activity = (expectedVersion, rate) => ap(admin + '/promotions', {
    expectedVersion, ...(rate === undefined ? {} : { activityName: '全场活动', activityPayableBasisPoints: rate }),
  }, 'PATCH');
  const issue = (customerUserId, terms) => ap(admin + '/promotions/coupons', {
    requestId: randomUUID(), customerUserId, name: '平台专属券', ...terms,
  });
  async function order(times = 100, { fromClient, couponId, actor = customer } = {}) {
    const input = { requestedGiftTimes: times, recipientGameAccount: '收心游戏号', requestId: randomUUID() };
    const saved = fromClient ? await cp(client + '/orders', { ...input, dispatcherUserId: dispatcher.id, platformCouponId: couponId }, 'POST', 201, actor)
      : await ep(employee + '/orders', { ...input, existingCustomerUserId: actor.id });
    return { id: saved.id, path: employee + '/orders/' + saved.id, ownerPath: client + '/orders/' + saved.id };
  }
  const price = (order, input = {}, status) => ep(order.path + '/pricing', {
    expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5, giftSegments: [segment(100)], ...input,
  }, 'PATCH', status);
  const receiptInput = (amount, pricingRevision = 1) => ({ requestId: randomUUID(), pricingRevision, receivedAmountCents: amount, receivedAt });
  const receive = (order, amount, revision) => ep(order.path + '/receipts', receiptInput(amount, revision));

  await t.test('九折、个人让利、锁价、105次实际履约和迟来的更正', async () => {
    await activity(0, 9000);
    const paidDate = '2026-11-21', giftDate = '2026-11-22';
    const target = await order();
    await price(target, { giftSegments: [withGift(100, 11)] }, 400);
    await price(target, { unlock: { quantity: 10, unitPriceCents: 1 } }, 400);
    await price(target, { unlock: { quantity: 10, unitPriceCents: 0 } }, 400);
    const { quote } = await price(target, { personalDiscountCents: 500, giftSegments: [withGift(100, 5)], unlock: { quantity: 10 } });
    assert.deepEqual([quote.originalHeartsAmountCents, quote.promotions.platform.amountCents, quote.promotions.personal.amountCents,
      quote.heartsAmountCents, quote.promotions.totalGiftTimes, quote.unlockAmountCents, quote.totalAmountCents],
      [5000, 500, 500, 4000, 105, 100, 4100]);
    assert.equal(quote.promotions.platform.version, 1);
    await activity(1, 8000);
    assert.deepEqual((await cp(target.ownerPath)).quote, quote);
    await receive(target, 4100);
    const dispatch = { requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: [paidDate, giftDate].map((date, segmentIndex) => ({
        segmentIndex, ...window(date), openToClaim: true, directed: [],
      })) };
    const published = await ep(target.path + '/publish', dispatch);
    assert.deepEqual(await ep(target.path + '/publish', dispatch), published);
    const allocation = await ep(target.path + '/gift-dispatch');
    assert.deepEqual([allocation.totals.paidGiftTimes, allocation.totals.promotionalGiftTimes], [100, 5]);
    const claim = (segmentIndex, dailyGiftTimes) => ep(employee + '/gift-claims/' + target.id, {
      requestId: randomUUID(), segmentIndex, kind: 'public', dailyGiftTimes,
    });
    const paidShare = (await claim(0, 100)).shareId;
    const giftShare = (await claim(1, 5)).shareId;
    for (let i = 0; i < 7; i++) await ep('/employee/songxinhao', { name: `用于履约的账号 ${i}` });
    const accounts = await ep('/employee/songxinhao/linkable');
    const accountPath = share => target.path + '/shares/' + share + '/execution-accounts';
    const first = await ep(accountPath(paidShare), { personalAccountId: accounts[0].id });
    await ep(accountPath(giftShare), { personalAccountId: accounts[0].id });
    for (let i = 0; i < 7; i++) {
      const linked = i ? await ep(accountPath(paidShare), { personalAccountId: accounts[i].id }) : first;
      await ep(accountPath(paidShare) + '/' + linked.id + '/relationship', { relationship: i === 6 ? 'existing_friend' : 'new_unlock' });
    }
    const report = (share, businessDate, giftTimes, status) => ep(accountPath(share) + '/' + first.id + '/daily-reports',
      { requestId: randomUUID(), kind: 'daily', businessDate, lines: [{ giftTimes, receivedHearts: giftTimes }] }, 'POST', status);
    await report(giftShare, giftDate, 5, 409);
    const paidReport = await report(paidShare, paidDate, 100);
    const giftReport = await report(giftShare, giftDate, 5);
    const completed = await cp(target.ownerPath);
    assert.deepEqual([completed.deliveryProgress.agreedGiftTimes, completed.deliveryProgress.deliveredPaidGiftTimes,
      completed.deliveryProgress.deliveredPromotionalGiftTimes, completed.deliveryProgress.remainingGiftTimes], [105, 100, 5, 0]);
    const basis = (await ep(target.path + '/fulfillment')).promotionBasis;
    assert.deepEqual(basis, {
      grossServiceCents: 5250, customerServiceCents: 4000, personalDiscountCents: 500, platformDiscountCents: 500,
      promotionalGiftCostCents: 250, unfulfilledServiceCents: 0, dispatchFeeCents: 525, clubFeeCents: 525, memberFeeCents: 4200,
    });
    assert.equal(basis.memberFeeCents + (basis.dispatchFeeCents - basis.personalDiscountCents) +
      (basis.clubFeeCents - basis.platformDiscountCents - basis.promotionalGiftCostCents), 4000);
    const unlock = (await ep(target.path + '/gift-dispatch')).unlockReview;
    assert.equal(unlock.members[0].userId, dispatcher.id);
    assert.deepEqual([unlock.estimatedAmountCents, unlock.actualAmountCents, unlock.differenceCents], [100, 60, -40]);
    const continuationId = randomUUID();
    const continuation = target.path + '/continuation-quotes/' + continuationId;
    await ep(target.path + '/continuation-quotes', {
      requestId: continuationId, segment: segment(20, 60), window: window('2026-11-24'),
    });
    await cp(target.ownerPath + '/continuation-quotes/' + continuationId + '/acceptance', { requestId: randomUUID() });
    assert.equal((await ep(continuation + '/receipt', { requestId: randomUUID(), receivedAmountCents: 1200, receivedAt })).segmentIndex, 2);
    assert.equal((await cp(target.ownerPath)).deliveryProgress.deliveredPromotionalGiftTimes, 5);
    await ep(target.path + '/daily-reports/' + giftReport.originalId + '/corrections', {
      requestId: randomUUID(), expectedVersion: 1, reason: '补记另一个账号的实际份额',
      lines: [{ giftTimes: 3, receivedHearts: 3 }],
    });
    const secondGiftAccount = await ep(accountPath(giftShare), { personalAccountId: accounts[1].id });
    await ep(accountPath(giftShare) + '/' + secondGiftAccount.id + '/daily-reports', {
      requestId: randomUUID(), businessDate: giftDate, reason: '按原执行日期补录',
      kind: 'supplement', lines: [{ giftTimes: 2, receivedHearts: 2 }],
    });
    const afterContinuation = await cp(target.ownerPath);
    assert.deepEqual([afterContinuation.deliveryProgress.agreedGiftTimes, afterContinuation.deliveryProgress.deliveredPromotionalGiftTimes,
      afterContinuation.deliveryProgress.remainingGiftTimes, afterContinuation.quote.heartsAmountCents], [125, 5, 20, 4000]);
    await ep(target.path + '/daily-reports/' + paidReport.originalId + '/corrections', {
      requestId: randomUUID(), expectedVersion: 1, reason: '按实际记录更正',
      lines: [{ giftTimes: 99, receivedHearts: 99 }],
    });
    const after = (await cp(target.ownerPath)).deliveryProgress;
    assert.deepEqual([after.deliveredPaidGiftTimes, after.deliveredPromotionalGiftTimes, after.excessGiftTimes], [99, 0, 5]);
    assert.equal(after.pendingPromotionalGiftTimes, 5);
  });

  await t.test('客户端预填、活动替代、门槛不含解锁、并发领用只成功一笔', async () => {
    await activity(2, 9000);
    const terms = { kind: 'threshold_coupon', thresholdCents: 5000, discountCents: 800 };
    const { couponId } = await issue(customer.id, terms);
    const other = await issue(outsider.id, terms);
    assert.deepEqual((await cp(client + '/order-options')).coupons.map(coupon => coupon.couponId), [couponId]);
    await cp(client + '/orders', { requestId: randomUUID(), recipientGameAccount: '借券', requestedGiftTimes: 100,
      platformCouponId: couponId }, 'POST', 400, outsider);
    const fromClient = await order(100, { fromClient: true, couponId });
    const noticePath = '/employee/clubs/client-order-notices';
    const notices = await ep(noticePath);
    assert.deepEqual(notices.map(item => item.orderId), [fromClient.id]);
    assert.equal(notices[0].clubId, club);
    await cp(noticePath, undefined, 'GET', 403);
    assert.equal((await ep(fromClient.path + '/pricing')).requestedPromotionCouponId, couponId);
    assert.equal((await price(fromClient)).quote.totalAmountCents, 4200);
    const alternative = await price(fromClient, { expectedRevision: 1, platformCouponId: null });
    assert.deepEqual([alternative.quote.totalAmountCents, alternative.quote.promotions.platform.kind], [4500, 'activity']);
    await receive(fromClient, 4500, 2);
    await ep(fromClient.path + '/publish', { requestId: randomUUID(), pricingRevision: 2, ruleVersion: 1, commissionReviewRevision: 0 });
    assert.deepEqual(await ep(noticePath), []);
    const threshold = await order(98);
    const notEligible = (await price(threshold, { giftSegments: [segment(98)], unlock: { quantity: 10 }, platformCouponId: couponId })).quote;
    assert.deepEqual([notEligible.originalHeartsAmountCents, notEligible.promotions.couponIssue, notEligible.promotions.platform.kind,
      notEligible.totalAmountCents], [4900, 'threshold', 'activity', 4510]);
    const first = await order(), second = await order();
    await price(first, { platformCouponId: other.couponId }, 400);
    await price(first, { platformDiscountCents: 1 }, 400);
    await price(first, { discountedHeartsAmountCents: 1 }, 400);
    await price(first, { platformCouponId: couponId });
    await price(second, { platformCouponId: couponId });
    await ep(first.path + '/receipts', receiptInput(4200, 2), 'POST', 409);
    assert.equal((await cp(client + '/order-options')).coupons.length, 1);
    const peer = await startPeer();
    const requests = [receiptInput(4200), receiptInput(4200)];
    const results = await Promise.all([first, second].map((target, index) =>
      ep(target.path + '/receipts', requests[index], 'POST', [201, 409], index ? peer : base)));
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results.findIndex(Boolean);
    assert.deepEqual(await ep([first, second][winner].path + '/receipts', requests[winner]), results[winner]);
    assert.equal((await cp(client + '/order-options')).coupons, undefined);
  });

  await t.test('整单上限、多价尾分和零价核款', async () => {
    await activity(3, undefined);
    const bought = await order();
    const { quote } = await price(bought, { giftSegments: [withGift(100, 5)] });
    assert.deepEqual([quote.totalAmountCents, quote.promotions.totalGiftTimes], [5000, 105]);
    const almost = await order(99);
    await price(almost, { giftSegments: [withGift(99, 10)] }, 400);
    assert.equal((await price(almost, { giftSegments: [withGift(99, 9)] })).quote.promotions.totalGiftTimes, 108);
    const tiny = await order(3);
    const issued = await issue(customer.id, { kind: 'threshold_coupon', thresholdCents: 3, discountCents: 1 });
    const giftSegments = [segment(1, 1), segment(1, 1, 'double'), segment(1, 1)];
    const cents = (await price(tiny, { giftSegments, platformCouponId: issued.couponId, personalDiscountCents: 1 })).quote;
    assert.equal(cents.totalAmountCents, 1);
    const shares = cents.promotions.segmentDiscounts.map(share => giftServiceAmounts(share, 0, 1));
    assert.deepEqual([shares.reduce((sum, row) => sum + row.platformDiscountCents, 0),
      shares.reduce((sum, row) => sum + row.personalDiscountCents, 0),
      shares.reduce((sum, row) => sum + row.serviceCents, 0)], [1, 1, 1]);
    assert.ok(shares.every(row => row.serviceCents >= 0));
    const zero = await price(tiny, { expectedRevision: 1, giftSegments, personalDiscountCents: 2 });
    assert.equal(zero.quote.totalAmountCents, 0);
    const publishZero = { requestId: randomUUID(), pricingRevision: 2, ruleVersion: 1, commissionReviewRevision: 0 };
    await ep(tiny.path + '/publish', publishZero, 'POST', 409);
    assert.equal((await receive(tiny, 0, 2)).paymentStatus, 'paid_in_full');
    assert.equal((await ep(tiny.path + '/publish', publishZero)).dispatchStatus, 'published');
  });

  await t.test('第 17 问个人让利，以及第 23 问满减券的按次退款依据', async () => {
    const personal = await order();
    const personalQuote = (await price(personal, { dispatchFeeCents: 3, personalDiscountCents: 500 })).quote;
    const half = await order();
    const { couponId } = await issue(customer.id, { kind: 'threshold_coupon', thresholdCents: 5000, discountCents: 500 });
    const couponQuote = (await price(half, { platformCouponId: couponId })).quote;
    const [local] = await ep('/employee/songxinhao/linkable');
    async function deliver(target, quote, sent) {
      await receive(target, quote.totalAmountCents);
      const date = '2026-11-23';
      await ep(target.path + '/publish', { requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
        giftDispatchSegments: [{ segmentIndex: 0, ...window(date), openToClaim: true, directed: [] }] });
      const { shareId } = await ep(employee + '/gift-claims/' + target.id, {
        requestId: randomUUID(), segmentIndex: 0, kind: 'public', dailyGiftTimes: 100,
      });
      const path = target.path + '/shares/' + shareId + '/execution-accounts';
      const linked = await ep(path, { personalAccountId: local.id });
      await ep(path + '/' + linked.id + '/daily-reports', {
        requestId: randomUUID(), kind: 'daily', businessDate: date, lines: [{ giftTimes: sent, receivedHearts: sent }],
      });
      return (await ep(target.path + '/fulfillment')).promotionBasis;
    }
    const personalBasis = await deliver(personal, personalQuote, 100);
    assert.deepEqual([personalQuote.heartsAmountCents, personalBasis.memberFeeCents, personalBasis.clubFeeCents,
      personalBasis.dispatchFeeCents - personalBasis.personalDiscountCents], [4500, 4200, 500, -200]);
    const couponBasis = await deliver(half, couponQuote, 90);
    assert.deepEqual([couponQuote.heartsAmountCents, couponBasis.unfulfilledServiceCents, couponBasis.platformDiscountCents,
      couponBasis.customerServiceCents], [4500, 450, 450, 4050]);
    assert.equal(((await cp(client + '/order-options')).coupons ?? []).some(coupon => coupon.couponId === couponId), false);
  });

  await t.test('各付费段分别赠送，沿用原段单价与期别，共用整单上限', async () => {
    const target = await order(20);
    await price(target, { giftSegments: [withGift(10, 2), withGift(10, 1, 80, 'double')] }, 400);
    const oneSegment = await price(target, { giftSegments: [withGift(10, 2), segment(10, 80, 'double')] });
    assert.equal(oneSegment.quote.promotions.totalGiftTimes, 22);
    const { quote } = await price(target, { expectedRevision: 1, giftSegments: [withGift(10, 1), withGift(10, 1, 80, 'double')] });
    assert.deepEqual([quote.heartsAmountCents, quote.promotions.totalGiftTimes], [1300, 22]);
    assert.deepEqual(quote.promotions.gift.segments.map(gift => [gift.sourceSegmentIndex, gift.promotionalGiftTimes]), [[0, 1], [1, 1]]);
    await receive(target, quote.totalAmountCents, 2);
    const paidDate = '2026-11-21', finalPaidDate = '2026-11-22', giftDate = '2026-11-23';
    await ep(target.path + '/publish', { requestId: randomUUID(), pricingRevision: 2, ruleVersion: 1, commissionReviewRevision: 0,
      giftDispatchSegments: [paidDate, finalPaidDate, giftDate, giftDate].map((date, segmentIndex) => ({
        segmentIndex, ...window(date), openToClaim: true, directed: [],
      })) });
    const inventory = await ep(target.path + '/gift-dispatch');
    assert.deepEqual(inventory.quotes.slice(2).map(gift => [gift.period, gift.unitPriceCents, gift.promotionalGiftTimes]),
      [['normal', 50, 1], ['double', 80, 1]]);
    const [local] = await ep('/employee/songxinhao/linkable');
    const shares = [];
    for (const [segmentIndex, dailyGiftTimes] of [10, 10, 1, 1].entries()) {
      const { shareId } = await ep(employee + '/gift-claims/' + target.id, { requestId: randomUUID(), segmentIndex, kind: 'public', dailyGiftTimes });
      const route = target.path + '/shares/' + shareId + '/execution-accounts';
      const { id } = await ep(route, { personalAccountId: local.id });
      shares.push({ shareId, route: route + '/' + id + '/daily-reports' });
    }
    const report = (index, date, lines, status) => ep(shares[index].route, {
      requestId: randomUUID(), kind: 'daily', businessDate: date,
      lines: lines.map(([shareIndex, giftTimes, receivedHearts]) => ({ shareId: shares[shareIndex].shareId, giftTimes, receivedHearts })),
    }, 'POST', status);
    await report(0, paidDate, [[0, 10, 10]]);
    await report(2, giftDate, [[2, 1, 1]], 409);
    await report(1, finalPaidDate, [[1, 10, 20]]);
    await report(2, giftDate, [[2, 1, 1], [3, 1, 2]]);
    const delivered = (await cp(target.ownerPath)).deliveryProgress;
    assert.deepEqual([delivered.deliveredPaidGiftTimes, delivered.deliveredPromotionalGiftTimes, delivered.actualReceivedHearts], [20, 2, 33]);
    const basis = (await ep(target.path + '/fulfillment')).promotionBasis;
    assert.deepEqual([basis.customerServiceCents, basis.promotionalGiftCostCents, basis.grossServiceCents], [1300, 130, 1430]);
  });

  await t.test('服务全免时仍独立核对新好友解锁款', async () => {
    await activity(4, 9000);
    const target = await order(1);
    const { quote } = await price(target, { giftSegments: [segment(1)], personalDiscountCents: 45, unlock: { quantity: 1 } });
    assert.deepEqual([quote.promotions.platform.amountCents, quote.promotions.personal.amountCents,
      quote.heartsAmountCents, quote.unlockAmountCents, quote.totalAmountCents], [5, 45, 0, 10, 10]);
    await ep(target.path + '/receipts', receiptInput(0), 'POST', 400);
    assert.equal((await receive(target, 10)).paymentStatus, 'paid_in_full');
  });
});
