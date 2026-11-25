import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { captchaCode, startSystem } from './start-system.mjs';

const origins = Object.fromEntries(['admin', 'employee', 'client', 'site'].map(app => [app, `https://${app}.single.test`]));
const staff = '/employee/club';
const admin = '/admin/club';
const options = '/client/club/order-options';
const customerOrders = '/client/orders';

test('单俱乐部启动、团长首次初始化及在线授权', { timeout: 120000 }, async t => {
  const { db, base, password, runCommand, restartServer, startPeer } = await startSystem(t, {
    database: 'single_club_e2e', origins, adminUsername: 'single_root',
    concurrentStarts: true, extraEnv: { CLUB_NAME: '第一家俱乐部' },
  });
  const clubs = db.collection('clubs');
  assert.deepEqual(await clubs.find().project({ name: 1 }).toArray(), [{ _id: 'club', name: '第一家俱乐部' }]);
  const command = (...args) => runCommand('dist/src/commands/club.js', ...args);
  await assert.rejects(command('club', 'other', '第二家俱乐部'), /init-leader/);
  await assert.rejects(command('grant', 'club', 'AB12', 'CLUB_FINANCE_READ'), /init-leader/);
  assert.equal(await clubs.countDocuments(), 1);

  async function request(app, path, actor, { method = 'GET', body, status = 200, server = base, cookie } = {}) {
    const headers = { origin: origins[app] };
    if (actor) headers.authorization = `Bearer ${actor.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(server + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    return { data: payload.data, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  }
  const call = async (...args) => (await request(...args)).data;
  const get = (app, path, actor, status, server) => call(app, path, actor, { status, server });
  const write = (app, path, actor, method, body, status = method === 'POST' ? 201 : 200) =>
    call(app, path, actor, { method, body, status });
  const credentials = async (app, action, username) => {
    const { cookie } = await request(app, `/captcha/${action}?app=${app}`);
    return call(app, `/user/${action}?type=account`, undefined, {
      method: 'POST', status: 201, cookie, body: { app, username, password, captcha: captchaCode },
    });
  };
  const login = (username, app) => credentials(app, 'login', username);
  const systemAdmin = await login('single_root', 'admin');
  const systemEmployee = await login('single_root', 'employee');
  const register = async (username, role = 'client') => {
    const account = await credentials('client', 'register', username);
    if (role !== 'client') {
      const { _id } = await db.collection('roles').findOne({ role_code: role });
      await write('admin', `/admin/user-manage/${account.id}/roles`, systemAdmin, 'PUT', { roleIds: [String(_id)] });
    }
    return login(username, role);
  };
  const first = await register('first_lead_candidate', 'employee');
  const second = await register('second_lead_candidate', 'employee');
  const member = await register('ordinary_member', 'employee');
  const financeAdmin = await register('finance_member', 'admin');
  const financeEmployee = await login('finance_member', 'employee');
  const buyer = await register('first_buyer');
  const otherBuyer = await register('second_buyer');
  const membership = (actor, target, active, status) =>
    write('employee', `${staff}/members/${target.id}`, actor, 'PUT', { active }, status);
  const grant = (actor, target, permission, granted, status) =>
    write('employee', `${staff}/authorizations/${target.id}/permission`, actor, 'PATCH', { permission, granted }, status);
  const appoint = (actor, target, deputy, status) =>
    write('employee', `${staff}/authorizations/${target.id}/deputy`, actor, 'PATCH', { deputy }, status);
  const rename = (actor, name, status) => write('employee', staff + '/name', actor, 'PATCH', { name }, status);
  const mark = (actor, target, dispatcher, status) =>
    write('employee', `${staff}/members/${target.id}/dispatcher`, actor, 'PATCH', { dispatcher }, status);
  const members = (actor, status) => get('employee', staff + '/members', actor, status);
  const authorizations = (actor, status) => get('employee', staff + '/authorizations', actor, status);
  const rule = (actor, expectedVersion, clubFeeCents, status) =>
    write('employee', staff + '/commission-rule', actor, 'PATCH', { expectedVersion, clubFeeCents }, status);
  const orderInput = () => ({ requestId: randomUUID(), recipientGameAccount: '接收游戏号', requestedGiftTimes: 10 });

  assert.equal(await get('employee', staff, first), null);
  await get('employee', staff + '/authorizations', undefined, 401);
  await grant(first, first, 'CLUB_MEMBERS_MANAGE', true, 403);
  await appoint(systemEmployee, systemEmployee, true, 403);
  await rename(systemEmployee, '越权名称', 403);
  await membership(systemEmployee, systemEmployee, true, 403);
  await assert.rejects(command('init-leader', buyer.id), /团员端准入权限/);

  const initializations = await Promise.allSettled([
    command('init-leader', first.id), command('init-leader', second.id),
  ]);
  assert.equal(initializations.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(initializations.find(result => result.status === 'rejected').reason.stderr, /已经初始化/);
  const [leader, deputy] = initializations[0].status === 'fulfilled' ? [first, second] : [second, first];
  await command('init-leader', leader.id);
  await assert.rejects(command('init-leader', deputy.id), /已经初始化/);
  assert.equal(await db.collection('club_members').countDocuments({ position: 'leader' }), 1);
  assert.deepEqual(await get('employee', staff, leader), {
    name: '第一家俱乐部', orderUrl: origins.client + '/order', canAssignPendingOrders: true, canDecideAdjustments: true,
    canManageAuthorizations: true, permissions: ['CLUB_MEMBERS_MANAGE', 'CLUB_COMMISSION_MANAGE'],
  });

  for (const target of [deputy, member, financeAdmin]) await membership(leader, target, true);
  await membership(leader, buyer, true, 400);
  await appoint(leader, deputy, true);
  await appoint(leader, leader, false, 404);
  await membership(leader, leader, false, 409);
  assert.deepEqual((await authorizations(leader)).members.map(({ userId }) => userId).sort(),
    [leader.id, deputy.id, member.id, financeAdmin.id].sort());
  await members(deputy, 403);
  await rule(deputy, 0, 3, 403);
  for (const actor of [deputy, member, financeEmployee, systemEmployee]) {
    await authorizations(actor, 403);
    await grant(actor, actor, 'CLUB_MEMBERS_MANAGE', true, 403);
    await appoint(actor, member, true, 403);
    await rename(actor, '越权名称', 403);
  }
  await grant(leader, deputy, 'CLUB_FINANCE_READ', true, 400);

  const pending = await write('client', customerOrders, buyer, 'POST', orderInput());
  assert.equal(pending.dispatchStatus, 'pending_assignment');
  const decide = (actor, status) => write('employee', `${staff}/orders/${pending.id}/assign-dispatcher`, actor, 'POST',
    { requestId: randomUUID(), dispatcherUserId: member.id }, status);
  await decide(member, 403);
  assert.equal((await decide(deputy)).dispatcherUserId, member.id);

  await grant(leader, deputy, 'CLUB_MEMBERS_MANAGE', true);
  assert.ok((await members(deputy)).some(entry => entry.userId === member.id));
  await mark(deputy, member, true);
  await rule(deputy, 0, 3, 403);
  await grant(deputy, member, 'CLUB_COMMISSION_MANAGE', true, 403);
  await appoint(deputy, member, true, 403);
  await rename(deputy, '越权名称', 403);
  await membership(deputy, deputy, false, 409);
  await write('employee', `${staff}/members/${member.id}`, deputy, 'PUT', { active: true, position: 'leader' }, 400);
  await get('admin', '/admin/user-manage', deputy, 403);
  await get('admin', admin + '/dispatch-pricing', deputy, 403);
  await grant(leader, deputy, 'CLUB_MEMBERS_MANAGE', false);
  await members(deputy, 403);
  await mark(deputy, member, false, 403);
  await grant(leader, deputy, 'CLUB_COMMISSION_MANAGE', true);
  assert.equal((await rule(deputy, 0, 3)).clubFeeCents, 3);
  await members(deputy, 403);
  await grant(leader, deputy, 'CLUB_COMMISSION_MANAGE', false);
  await rule(deputy, 1, 4, 403);
  await grant(leader, member, 'CLUB_MEMBERS_MANAGE', true);
  assert.ok((await members(member)).some(entry => entry.userId === leader.id));
  await grant(leader, member, 'CLUB_MEMBERS_MANAGE', false);
  await members(member, 403);

  const clientOrder = await write('client', customerOrders, buyer, 'POST', orderInput());
  assert.equal(clientOrder.dispatcherUserId, member.id);
  assert.equal((await get('client', `${customerOrders}/${clientOrder.id}`, buyer)).id, clientOrder.id);
  await get('client', `${customerOrders}/${clientOrder.id}`, otherBuyer, 404);
  await get('employee', `${staff}/orders/${clientOrder.id}`, deputy, 404);
  const notices = (actor) => get('employee', staff + '/client-order-notices', actor);
  assert.deepEqual(new Set((await notices(member)).map(notice => notice.orderId)), new Set([pending.id, clientOrder.id]));
  assert.deepEqual(await notices(deputy), []);
  await get('client', '/client/clubs/another/order-options', buyer, 404);
  await write('client', customerOrders, buyer, 'POST', { ...orderInput(), clubId: 'another' }, 400);

  await get('admin', admin + '/orders', financeAdmin, 403);
  for (const permission of ['CLUB_ORDERS_READ', 'CLUB_COMMISSION_MANAGE']) await grant(leader, financeEmployee, permission, true);
  const orderPath = `${staff}/orders/${clientOrder.id}`;
  const quote = await write('employee', orderPath + '/pricing', member, 'PATCH', {
    ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 7,
    giftSegments: [{ period: 'normal', paidGiftTimes: 10, dailyGiftTimes: 10, unitPriceCents: 50 }],
  });
  assert.equal(quote.quote.totalAmountCents, 500);
  await write('employee', orderPath + '/receipts', member, 'POST', {
    requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 500,
    receivedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  const businessDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const published = await write('employee', orderPath + '/publish', member, 'POST', {
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, startDate: businessDate, endDate: businessDate, openToClaim: true, directed: [] }],
  });
  assert.equal(published.dispatchStatus, 'published');
  assert.deepEqual((await notices(member)).map(notice => notice.orderId), [pending.id]);
  const accepted = await write('employee', `${staff}/gift-claims/${clientOrder.id}`, deputy, 'POST', {
    requestId: randomUUID(), segmentIndex: 0, kind: 'public', dailyGiftTimes: 5,
  });
  assert.equal(accepted.giftTimes, 5);
  const inboxPath = '/employee/dispatch-notices';
  for (const actor of [leader, deputy, member, financeEmployee]) {
    let notice;
    for (let attempt = 0; attempt < 40 && !notice; attempt++) {
      notice = (await get('employee', inboxPath, actor)).items.find(({ orderId }) => orderId === clientOrder.id);
      if (!notice) await sleep(200);
    }
    assert.ok(notice, `本团成员 ${actor.id} 应收到本次发布通知`);
    if (actor !== member) {
      const foreign = await get('employee', `${inboxPath}/${notice.id}/claim-board`, member);
      assert.equal(foreign.status, 'missing');
    }
  }
  assert.deepEqual((await get('employee', inboxPath, systemEmployee)).items, []);
  await membership(leader, financeEmployee, false);
  assert.deepEqual((await get('employee', inboxPath, financeEmployee)).items, []);
  await membership(leader, financeEmployee, true);
  for (const permission of ['CLUB_ORDERS_READ', 'CLUB_COMMISSION_MANAGE']) await grant(leader, financeEmployee, permission, true);
  const financeHistory = () => get('admin', admin + '/dispatch-pricing', financeAdmin);
  assert.equal((await financeHistory()).items[0].dispatchFeeCents, undefined);
  await grant(leader, financeEmployee, 'CLUB_FINANCE_READ', true);
  assert.equal((await financeHistory()).items[0].dispatchFeeCents, 7);
  await rename(financeEmployee, '越权名称', 403);
  await grant(leader, financeEmployee, 'CLUB_FINANCE_READ', false);
  assert.equal((await financeHistory()).items[0].dispatchFeeCents, undefined);

  await rename(leader, '  ', 400);
  assert.deepEqual(await rename(leader, '  本团新名  '), { name: '本团新名' });
  const peer = await startPeer({ CLUB_NAME: '环境尝试改名' });
  assert.equal((await get('employee', staff, member, 200, peer)).name, '本团新名');
  assert.equal((await get('admin', admin, systemAdmin, 200, peer)).name, '本团新名');
  assert.equal((await get('client', options, buyer, 200, peer)).clubName, '本团新名');
  await restartServer({ CLUB_NAME: '重启尝试改名' });
  assert.equal((await get('employee', staff, leader)).name, '本团新名');
  assert.equal((await get('employee', staff, leader)).canManageAuthorizations, true);
  assert.deepEqual(await clubs.find().project({ name: 1 }).toArray(), [{ _id: 'club', name: '本团新名' }]);
});
