import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';
import { checkDirectCustomers } from './direct-customers.mjs';

const origin = (app) => `https://${app}.club.test`;
const require = createRequire(import.meta.url);

test('共享订单生产入口按平台账号、俱乐部和当单职责读写', { timeout: 120000 }, async (t) => {
  const { db, base, password, runCommand } = await startSystem(t, {
    database: 'club_orders_e2e',
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map((app) => [app, origin(app)])),
    adminUsername: 'club_admin',
  });
  const configure = (...args) => runCommand('dist/src/commands/club.js', ...args);
  const challenges = new Map();
  const api = async (app, path, { method = 'GET', body, token, status = 200, message } = {}) => {
    const headers = { origin: origin(app) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith('/user/') && challenges.has(app)) {
      headers.cookie = challenges.get(app);
      challenges.delete(app);
    }
    const response = await fetch(base + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    if (Array.isArray(status)) {
      assert.ok(status.includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
    } else {
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
    }
    if (message) assert.match(payload.message, message);
    if (path.startsWith('/captcha/')) {
      const challenge = response.headers.getSetCookie().find((cookie) => cookie.startsWith('sky_captcha_'));
      assert.ok(challenge);
      challenges.set(app, challenge.split(';')[0]);
    }
    return payload.data;
  };

  const login = async (app, username) => {
    await api(app, `/captcha/login?app=${app}`);
    return api(app, '/user/login?type=account', {
      method: 'POST', status: 201, body: { app, username, password, captcha: captchaCode },
    });
  };
  const administrator = await login('admin', 'club_admin');
  const register = async (username, app) => {
    await api('client', '/captcha/register?app=client');
    const account = await api('client', '/user/register?type=account', {
      method: 'POST', status: 201, body: { app: 'client', username, password, captcha: captchaCode },
    });
    if (app !== 'client') {
      const role = await db.collection('roles').findOne({ role_code: app });
      assert.ok(role);
      await api('admin', `/admin/user-manage/${account.id}/roles`, {
        method: 'PUT', token: administrator.token, body: { roleIds: [String(role._id)] },
      });
    }
    assert.match(account.id, /^[A-Z0-9]{4}$/);
    return login(app, username);
  };

  const dispatcher = await register('club_first_member', 'employee');
  const executor = await register('club_second_member', 'employee');
  const outsider = await register('club_other_member', 'employee');
  const owner = await register('club_first_customer', 'client');
  const stranger = await register('club_second_customer', 'client');
  const adminEmployee = await login('employee', 'club_admin');
  const member = (clubId, user, status, mark) => configure('member', clubId, user.id, status, mark);

  await configure('club', 'main', '送心俱乐部');
  await configure('club', 'side', '另一俱乐部');
  await configure('club', 'empty', '无候选俱乐部');
  await member('main', dispatcher, 'active', 'dispatcher');
  await member('main', executor, 'active', 'member');
  await member('side', outsider, 'active', 'dispatcher');
  await assert.rejects(member('main', owner, 'active', 'dispatcher'), /团员端准入权限/);
  const membership = db.collection('club_members');
  assert.equal(await membership.countDocuments({ clubId: 'main' }), 2);
  assert.equal((await membership.findOne({ clubId: 'main', userId: dispatcher.id })).dispatcher, true);

  const employeeOrders = '/employee/clubs/main/orders';
  const clientOrders = '/client/clubs/main/orders';
  const orders = db.collection('club_orders');
  const mongoId = (id) => new mongoose.Types.ObjectId(id);
  const get = (app, route, actor, status) => api(app, route, { token: actor.token, status });
  const post = (app, route, actor, body, status = 201) => api(app, route, { method: 'POST', token: actor.token, body, status });
  const orderInput = (requestedGiftTimes = 100) => ({ requestId: randomUUID(), recipientGameAccount: '接收游戏号', requestedGiftTimes });
  let direct;
  let selected;
  let random;

  await t.test('旧调用只提交称呼或游戏号时，直接单保持归属待核', async () => {
    await api('employee', employeeOrders, { status: 401 });
    await post('employee', employeeOrders, owner, orderInput(), 403);
    await get('employee', employeeOrders, adminEmployee, 403);
    for (const field of ['clubId', 'source', 'businessType', 'customerUserId', 'createdByUserId', 'dispatcherUserId', 'dispatchStatus', 'publishedAt', 'shares', 'clubCommission']) {
      await post('employee', employeeOrders, dispatcher, { ...orderInput(), [field]: owner.id }, 400);
    }
    const input = { ...orderInput(50), customerLabel: owner.id };
    const direct = await post('employee', employeeOrders, dispatcher, input);
    assert.equal((await post('employee', employeeOrders, dispatcher, input)).id, direct.id);
    assert.equal(direct.source, 'direct_dispatch');
    assert.equal(direct.businessType, 'heart_delivery');
    assert.equal(direct.dispatcherAssignment, 'creator');
    assert.equal(direct.createdByUserId, dispatcher.id);
    assert.equal(direct.dispatcherUserId, dispatcher.id);
    assert.equal(direct.customerUserId, null);
    assert.equal(direct.customerLinkStatus, 'pending_verification');
    assert.equal(direct.customerLabel, owner.id);
    assert.equal(direct.dispatchStatus, 'draft');
    assert.equal(direct.publishedAt, null);
    assert.deepEqual(direct.shares, []);
    assert.equal((await orders.findOne({ _id: mongoId(direct.id) })).customerUserId, undefined);
    await get('employee', `${employeeOrders}/${direct.id}`, executor, 404);
    await get('client', `${clientOrders}/${direct.id}`, owner, 404);

    const nickname = '同名客户';
    await db.collection('users').updateMany({ _id: { $in: [owner.id, stranger.id] } }, { $set: { nickname } });
    const executorDraft = await post('employee', employeeOrders, executor, { ...orderInput(), customerLabel: nickname });
    assert.equal(executorDraft.dispatcherUserId, executor.id);
    await get('client', `${clientOrders}/${executorDraft.id}`, owner, 404);
    await get('client', `${clientOrders}/${executorDraft.id}`, stranger, 404);
  });

  await t.test('客户端归属取会话，候选只含本俱乐部有效标记团员；并发重试保留同一单', async () => {
    for (const invalid of [outsider, executor, owner]) {
      await post('client', clientOrders, owner, { ...orderInput(), dispatcherUserId: invalid.id }, 400);
    }
    for (const field of ['customerUserId', 'createdByUserId', 'dispatchStatus', 'customerLinkStatus', 'shares']) {
      await post('client', clientOrders, owner, { ...orderInput(), [field]: stranger.id }, 400);
    }
    await post('client', '/client/clubs/missing/orders', owner, orderInput(), 404);
    assert.equal(await orders.countDocuments({ source: 'client_order' }), 0);
    const input = orderInput();
    const results = await Promise.all(Array.from({ length: 6 }, () => post('client', clientOrders, owner, input)));
    [random] = results;
    assert.ok(results.every((result) => result.id === random.id && result.dispatcherUserId === dispatcher.id));
    assert.equal(random.dispatcherAssignment, 'random');
    assert.equal(await orders.countDocuments({ source: 'client_order' }), 1);
    assert.equal((await post('client', clientOrders, owner, { ...input, requestId: input.requestId.toUpperCase() })).id, random.id);
    await post('client', clientOrders, owner, { ...input, requestedGiftTimes: 99 }, 409);

    await member('main', executor, 'active', 'dispatcher');
    const explicit = { ...orderInput(), dispatcherUserId: executor.id };
    selected = await post('client', clientOrders, owner, explicit);
    assert.equal(selected.dispatcherAssignment, 'customer_selected');
    assert.equal(selected.dispatcherUserId, executor.id);
    assert.equal(selected.dispatchStatus, 'pending');
    const saved = await orders.findOne({ _id: mongoId(selected.id) });
    assert.equal(saved.source, 'client_order');
    assert.equal(saved.customerUserId, owner.id);
    assert.equal(saved.createdByUserId, owner.id);
    assert.equal(saved.customerLinkStatus, 'verified');
    assert.equal(saved.heartDelivery.requestedGiftTimes, 100);
    assert.equal(saved.publishedAt, undefined);
    assert.equal((await get('employee', `${employeeOrders}/${selected.id}`, executor)).id, selected.id);
    await get('employee', `${employeeOrders}/${selected.id}`, dispatcher, 404);
    await get('employee', `${employeeOrders}/${selected.id}`, outsider, 403);
    await get('employee', `/employee/clubs/side/orders/${selected.id}`, outsider, 404);
    await get('client', `${clientOrders}/${selected.id}`, stranger, 404);
    assert.deepEqual((await get('client', clientOrders, stranger)).items, []);
    assert.deepEqual(new Set((await get('client', clientOrders, owner)).items.map((order) => order.id)), new Set([random.id, selected.id]));
    assert.deepEqual((await get('client', `${clientOrders}?source=direct_dispatch`, owner)).items, []);
    await get('client', `${clientOrders}?source=listed`, owner, 400);
    await get('client', `${clientOrders}?customerUserId=${stranger.id}`, owner, 400);
    const page = await get('client', `${clientOrders}?limit=1`, owner);
    assert.equal(page.items.length, 1);
    assert.equal((await get('client', `${clientOrders}?limit=1&after=${page.nextCursor}`, owner)).items[0].id, random.id);
  });

  await t.test('团员在两单中互换职责，可在同单兼任；客户只读本人订单', async () => {
    direct = await post('employee', employeeOrders, dispatcher, {
      ...orderInput(50),
      existingCustomerUserId: owner.id,
    });
    assert.equal(direct.customerUserId, owner.id);
    assert.equal(direct.customerLinkStatus, 'verified');
    await get('employee', `${employeeOrders}/${direct.id}`, executor, 404);
    await get('employee', `${employeeOrders}/${selected.id}`, dispatcher, 404);

    // 发布和承接由 P1-07 接入。建单、客户绑定和下文读取均通过正式 HTTP 入口。
    const { ClubOrderSchema } = require('../dist/src/modules/club/club-order.schema.js');
    const OrderFixture = mongoose.model('ClubOrderFixture', ClubOrderSchema);
    const publishFixture = async (order, shares) => {
      const key = { _id: mongoId(order.id) };
      const fixture = OrderFixture.hydrate(await orders.findOne(key));
      fixture.dispatchStatus = 'published';
      fixture.publishedAt = new Date();
      for (const [actor, ...accounts] of shares) {
        fixture.shares.push({
          userId: actor.id,
          hearts: 50,
          executionGameAccounts: accounts.map((name) => ({ name })),
        });
      }
      await fixture.validate();
      await orders.replaceOne(key, fixture.toObject());
    };
    await publishFixture(direct, [[executor, '同名送心号', '同名送心号']]);
    await publishFixture(selected, [[dispatcher, '团员甲游戏号'], [executor, '团员乙游戏号']]);

    const first = await get('employee', `${employeeOrders}/${direct.id}`, dispatcher);
    const second = await get('employee', `${employeeOrders}/${direct.id}`, executor);
    assert.equal(second.id, first.id);
    assert.equal(second.shares[0].id, first.shares[0].id);
    assert.equal(second.recipientGameAccount, first.recipientGameAccount);
    assert.equal(second.shares[0].hearts, 50);
    const accounts = second.shares[0].executionGameAccounts;
    assert.deepEqual(accounts.map((account) => account.name), ['同名送心号', '同名送心号']);
    assert.notEqual(accounts[0].id, accounts[1].id);
    assert.deepEqual((await get('employee', `${employeeOrders}/${direct.id}`, executor)).shares[0].executionGameAccounts, accounts);
    assert.equal(first.customerUserId, owner.id);
    assert.equal(first.shares[0].executionGameAccounts, undefined);
    assert.equal(second.customerUserId, undefined);
    assert.equal(second.customerLabel, undefined);
    const reversed = await get('employee', `${employeeOrders}/${selected.id}`, dispatcher);
    assert.deepEqual(reversed.shares.map(({ userId }) => userId), [dispatcher.id]);
    assert.deepEqual(reversed.shares[0].executionGameAccounts.map((account) => account.name), ['团员甲游戏号']);
    assert.equal(reversed.source, 'client_order');
    assert.equal(reversed.customerUserId, undefined);
    const both = await get('employee', `${employeeOrders}/${selected.id}`, executor);
    assert.equal(both.customerUserId, owner.id);
    assert.equal(both.dispatcherUserId, executor.id);
    assert.deepEqual(both.shares.map(({ userId }) => userId), [dispatcher.id, executor.id]);
    assert.equal(both.shares[0].executionGameAccounts, undefined);
    assert.deepEqual(both.shares[1].executionGameAccounts.map(({ name }) => name), ['团员乙游戏号']);
    const assigned = (await get('employee', employeeOrders, executor)).items;
    assert.deepEqual(assigned.find(({ id }) => id === direct.id), second);
    assert.deepEqual(assigned.find(({ id }) => id === selected.id), both);
    await get('employee', `${employeeOrders}/${selected.id}`, outsider, 403);

    const sideOrder = await post('employee', '/employee/clubs/side/orders', outsider, {
      ...orderInput(),
      existingCustomerUserId: owner.id,
    });
    assert.deepEqual((await get('client', `${clientOrders}?source=direct_dispatch`, owner)).items.map((order) => order.id), [direct.id]);
    assert.deepEqual(new Set((await get('client', `${clientOrders}?source=client_order`, owner)).items.map((order) => order.id)), new Set([random.id, selected.id]));
    assert.deepEqual(new Set((await get('client', '/client/orders', owner)).items.map(({ id }) => id)),
      new Set([direct.id, sideOrder.id, random.id, selected.id]));
    for (const order of [direct, selected]) {
      const clientView = await get('client', `${clientOrders}/${order.id}`, owner);
      assert.equal(clientView.customerLabel, undefined);
      assert.equal(clientView.shares, undefined);
      await get('client', `${clientOrders}/${order.id}`, stranger, 404);
      await get('client', `/client/clubs/side/orders/${order.id}`, owner, 404);
    }
    assert.equal((await get('client', `/client/clubs/side/orders/${sideOrder.id}`, owner)).id, sideOrder.id);
    await get('client', `${clientOrders}/${sideOrder.id}`, owner, 404);
    assert.deepEqual((await get('client', '/client/orders', stranger)).items, []);

    await member('main', executor, 'inactive', 'dispatcher');
    await get('employee', `${employeeOrders}/${direct.id}`, executor, 403);
    await get('employee', `${employeeOrders}/${selected.id}`, executor, 403);
    await get('employee', employeeOrders, executor, 403);
    await post('client', clientOrders, owner, { ...orderInput(), dispatcherUserId: executor.id }, 400);
    assert.equal((await post('client', clientOrders, owner, { ...orderInput(), dispatcherUserId: dispatcher.id })).dispatcherUserId, dispatcher.id);
  });

  await checkDirectCustomers(t, { db, base, api, configure, register, dispatcher, outsider });

  await t.test('管理端按俱乐部及单项职责授权，已登录会话立即体现授权变更', async (adminTest) => {
    const secondAdmin = await register('club_second_admin', 'admin');
    assert.deepEqual(secondAdmin.roles, administrator.roles);
    await member('main', administrator, 'active', 'dispatcher');
    await member('side', administrator, 'active', 'member');
    await member('main', secondAdmin, 'active', 'member');
    await member('side', secondAdmin, 'active', 'member');
    await member('main', executor, 'active', 'member');
    const sideOrder = await post('employee', '/employee/clubs/side/orders', outsider, orderInput());
    const adminClubs = '/admin/clubs';
    const mainOrders = adminClubs + '/main/orders';
    const sideOrders = adminClubs + '/side/orders';
    const membersRoute = adminClubs + '/main/members';
    const markRoute = (userId) => `${membersRoute}/${userId}/dispatcher`;
    const adminGet = (route, actor = administrator, status) => get('admin', route, actor, status);
    const mark = (userId, body, actor = administrator, status) => api('admin', markRoute(userId), {
      method: 'PATCH', token: actor.token, body, status,
    });
    const grant = (clubId, actor, permission) => configure('grant', clubId, actor.id, permission);
    const revoke = (clubId, actor, permission) => configure('revoke', clubId, actor.id, permission);

    await get('employee', `${employeeOrders}/${direct.id}`, adminEmployee, 404);
    assert.deepEqual((await get('employee', employeeOrders, adminEmployee)).items, []);

    // 成员旧数据可能没有权限字段。
    await membership.updateOne({ clubId: 'main', userId: administrator.id }, { $unset: { permissions: '' } });
    await api('admin', adminClubs, { status: 401 });
    await adminGet(adminClubs, adminEmployee, 403);
    assert.deepEqual(await adminGet(adminClubs), []);
    await adminGet(mainOrders, administrator, 403);
    await adminGet(`${mainOrders}/${direct.id}`, administrator, 403);
    await adminGet(membersRoute, administrator, 403);
    await mark(executor.id, { dispatcher: true }, administrator, 403);
    await assert.rejects(grant('main', executor, 'CLUB_COMMISSION_MANAGE'), /管理端准入权限/);

    await grant('main', administrator, 'CLUB_ORDERS_READ');
    await grant('side', administrator, 'CLUB_MEMBERS_MANAGE');
    await grant('side', secondAdmin, 'CLUB_ORDERS_READ');
    assert.deepEqual(await adminGet(adminClubs), [
      { id: 'main', name: '送心俱乐部', permissions: ['CLUB_ORDERS_READ'] },
      { id: 'side', name: '另一俱乐部', permissions: ['CLUB_MEMBERS_MANAGE'] },
    ]);
    const monitored = (await adminGet(mainOrders)).items;
    assert.ok(monitored.length > 0 && monitored.every((order) => order.clubId === 'main'));
    assert.ok([direct.id, selected.id, random.id].every((id) => monitored.some((order) => order.id === id)));
    const financialFields = {
      dispatchPricing: { clubFeeCents: 500 },
      receipt: { receivedAmountCents: 5100 },
    };
    // 监管投影不得透传持久化的资金字段。团抽、收款业务由后续任务接入。
    await orders.updateOne({ _id: mongoId(direct.id) }, { $set: financialFields });
    const adminOrder = await adminGet(`${mainOrders}/${direct.id}`);
    assert.deepEqual(adminOrder, monitored.find(({ id }) => id === direct.id));
    assert.deepEqual((await adminGet(mainOrders)).items, monitored);
    await orders.updateOne({ _id: mongoId(direct.id) }, { $unset: { dispatchPricing: '', receipt: '' } });
    assert.equal(adminOrder.customerUserId, owner.id);
    assert.equal(adminOrder.shares.length, 1);
    assert.equal(adminOrder.shares[0].userId, executor.id);
    assert.equal(adminOrder.shares[0].executionGameAccounts, undefined);
    assert.equal(adminOrder.requestId, undefined);
    await adminGet(`${mainOrders}/${sideOrder.id}`, administrator, 404);
    await adminGet(mainOrders, adminEmployee, 403);
    await adminGet(mainOrders, secondAdmin, 403);
    await adminGet(sideOrders, administrator, 403);
    assert.equal((await adminGet(sideOrders, secondAdmin)).items[0].id, sideOrder.id);
    await adminGet(`${sideOrders}/${direct.id}`, secondAdmin, 404);
    await adminGet(membersRoute, administrator, 403);
    assert.ok((await adminGet(adminClubs + '/side/members')).some((member) => member.userId === outsider.id));

    await grant('main', administrator, 'CLUB_MEMBERS_MANAGE');
    const nickname = '同名团员';
    await db.collection('users').updateMany(
      { _id: { $in: [dispatcher.id, executor.id] } },
      { $set: { nickname } },
    );
    const roster = await adminGet(membersRoute);
    assert.deepEqual(new Set(roster.filter((member) => member.nickname === nickname).map((member) => member.userId)),
      new Set([dispatcher.id, executor.id]));
    assert.ok(!roster.some((member) => member.userId === outsider.id));
    assert.ok(roster.every((member) => member.permissions === undefined && member.email === undefined));
    await mark(executor.id, { dispatcher: true }, secondAdmin, 403);
    for (const forbidden of [{ active: true }, { clubId: 'side' }, { permissions: ['CLUB_FINANCE_READ'] }]) {
      await mark(executor.id, { dispatcher: true, ...forbidden }, administrator, 400);
    }
    await mark(executor.id, { dispatcher: 'true' }, administrator, 400);
    await mark(outsider.id, { dispatcher: true }, administrator, 404);
    const requested = () => ({ ...orderInput(), dispatcherUserId: executor.id });
    await post('client', clientOrders, owner, requested(), 400);
    assert.deepEqual(await mark(executor.id, { dispatcher: true }), {
      userId: executor.id, active: true, dispatcher: true, nickname,
    });
    assert.equal((await post('client', clientOrders, owner, requested())).dispatcherUserId, executor.id);
    assert.equal((await mark(executor.id, { dispatcher: false })).dispatcher, false);
    await post('client', clientOrders, owner, requested(), 400);

    await adminTest.test('规则与财务服务共用的授权边界按操作和俱乐部独立判定', async () => {
      const { ClubDirectoryService } = require('../dist/src/modules/club/club-directory.service.js');
      const { Club, ClubSchema, ClubMember, ClubMemberSchema } = require('../dist/src/modules/club/club.schema.js');
      const connection = mongoose.createConnection().setClient(db.client);
      const directory = new ClubDirectoryService(
        connection.model(Club.name, ClubSchema),
        connection.model(ClubMember.name, ClubMemberSchema),
      );
      const session = ({ id, roles }, app = 'admin') => ({ id, roles, app });
      const check = (clubId, user, permission) => directory.requireAdminPermission(clubId, user, permission);
      const denied = (clubId, user, permission) => assert.rejects(
        check(clubId, user, permission),
        (error) => error.getStatus() === 403,
      );
      const rule = 'CLUB_COMMISSION_MANAGE';
      const finance = 'CLUB_FINANCE_READ';
      const operator = session(administrator);
      const specialist = session(secondAdmin);
      await denied('main', session(executor, 'employee'), rule);
      await denied('main', operator, rule);
      await denied('main', operator, finance);

      await grant('main', secondAdmin, rule);
      assert.deepEqual((await adminGet(adminClubs, secondAdmin))[0].permissions, [rule]);
      await check('main', specialist, rule);
      await denied('main', session(secondAdmin, 'employee'), rule);
      await denied('side', specialist, rule);
      await denied('main', specialist, finance);
      await adminGet(mainOrders, secondAdmin, 403);
      await adminGet(membersRoute, secondAdmin, 403);

      await grant('main', secondAdmin, finance);
      assert.deepEqual((await adminGet(adminClubs, secondAdmin))[0].permissions, [rule, finance]);
      await check('main', specialist, finance);
      await denied('side', specialist, finance);
      await revoke('main', secondAdmin, rule);
      assert.deepEqual((await adminGet(adminClubs, secondAdmin))[0].permissions, [finance]);
      await denied('main', specialist, rule);
      await check('main', specialist, finance);
      await adminGet(mainOrders, secondAdmin, 403);
      await adminGet(membersRoute, secondAdmin, 403);

      await revoke('main', secondAdmin, finance);
      await denied('main', specialist, finance);
      assert.deepEqual((await adminGet(adminClubs, secondAdmin)).map(({ id }) => id), ['side']);
    });

    await revoke('main', administrator, 'CLUB_ORDERS_READ');
    await adminGet(mainOrders, administrator, 403);
    await adminGet(membersRoute);
    await member('main', administrator, 'inactive', 'dispatcher');
    await adminGet(membersRoute, administrator, 403);
    assert.deepEqual((await adminGet(adminClubs)).map(({ id }) => id), ['side']);
    await member('main', administrator, 'active', 'dispatcher');
    assert.deepEqual((await membership.findOne({ clubId: 'main', userId: administrator.id })).permissions, []);
    await adminGet(mainOrders, administrator, 403);
    await adminGet(membersRoute, administrator, 403);
    await grant('main', administrator, 'CLUB_MEMBERS_MANAGE');
    await adminGet(membersRoute);
    await adminGet(mainOrders, administrator, 403);
  });

  await t.test('按次抽成和首段快照通过真实 Mongo 保存，续段继承原规则', async (t) => {
    const ruleRoute = '/admin/clubs/main/commission-rule';
    const historyRoute = '/admin/clubs/main/dispatch-pricing';
    const patch = (app, route, actor, body, status) => api(app, route, { method: 'PATCH', token: actor.token, body, status });
    const adminGet = (route, status) => get('admin', route, administrator, status);
    const grant = (permission) => configure('grant', 'main', administrator.id, permission);
    const revoke = (permission) => configure('revoke', 'main', administrator.id, permission);
    const makeDirect = () => post('employee', employeeOrders, dispatcher, { ...orderInput(), existingCustomerUserId: owner.id });
    const draft = await makeDirect();
    const client = await post('client', clientOrders, owner, { ...orderInput(), estimatedReceivedHearts: 200, dispatcherUserId: dispatcher.id });
    const unreviewed = await makeDirect();
    const route = (order) => `${employeeOrders}/${order.id}`;
    const pricingRoute = (order) => route(order) + '/pricing';
    const giftSegments = [{ period: 'normal', paidGiftTimes: 100, dailyGiftTimes: 10, unitPriceCents: 50 }];
    const doubleSegments = [{ ...giftSegments[0], period: 'double' }];
    const draftInput = { ruleVersion: 1, expectedRevision: 0, dispatchFeeCents: 5, giftSegments };
    const ruleInput = { expectedVersion: 0, clubFeeCents: 5 };
    const savePrice = (order, input = draftInput, status = 200) => patch('employee', pricingRoute(order), dispatcher, input, status);
    const saveRule = (input = ruleInput, status = 200) => patch('admin', ruleRoute, administrator, input, status);

    await adminGet(ruleRoute, 403);
    await saveRule(ruleInput, 403);
    await grant('CLUB_ORDERS_READ');
    await adminGet(historyRoute, 403);
    await revoke('CLUB_ORDERS_READ');
    await grant('CLUB_COMMISSION_MANAGE');
    assert.equal(await adminGet(ruleRoute), null);
    await adminGet('/admin/clubs/side/commission-rule', 403);
    await adminGet(historyRoute, 403);
    assert.equal((await get('employee', pricingRoute(draft), dispatcher)).pricing, null);
    await savePrice(draft, draftInput, 409);
    await patch('admin', ruleRoute, dispatcher, ruleInput, 403);
    await patch('admin', ruleRoute, adminEmployee, ruleInput, 403);
    for (const invalid of [{ basis: 'received_hearts' }, { dispatchFeeCents: 5 }, { clubId: 'side' }, { clubFeeCents: -1 }, { clubFeeCents: 0.5 }]) {
      await saveRule({ ...ruleInput, ...invalid }, 400);
    }
    const raced = await Promise.all([saveRule(ruleInput, [200, 409]), saveRule(ruleInput, [200, 409])]);
    const versionOne = { basis: 'gift_times', clubFeeCents: 5, version: 1 };
    assert.deepEqual(raced.filter(Boolean), [versionOne]);
    assert.deepEqual(await adminGet(ruleRoute), versionOne);

    await t.test('两种订单来源按次分段报价，预估解锁单列，原实收与报价可核对', async () => {
      const unlock = { quantity: 10, unitPriceCents: 10 };
      const mixedSegments = [
        { period: 'double', paidGiftTimes: 60, dailyGiftTimes: 6, unitPriceCents: 50 },
        { period: 'normal', paidGiftTimes: 40, dailyGiftTimes: 4, unitPriceCents: 65 },
      ];
      for (const { app, deliveryPeriodPreference, doubleGiftTimes, expected, segments, heartsAmountCents } of [
        { app: 'employee', deliveryPeriodPreference: 'normal', expected: 100, segments: giftSegments, heartsAmountCents: 5000 },
        { app: 'client', deliveryPeriodPreference: 'double', expected: 200, segments: doubleSegments, heartsAmountCents: 5000 },
        { app: 'employee', deliveryPeriodPreference: 'split', doubleGiftTimes: 60, expected: 160, segments: mixedSegments, heartsAmountCents: 5600 },
      ]) {
        const isDirect = app === 'employee';
        const createRoute = isDirect ? employeeOrders : clientOrders;
        const customerRoute = (id) => `${clientOrders}/${id}`;
        const creator = isDirect ? dispatcher : owner;
        const input = {
          ...orderInput(), deliveryPeriodPreference, doubleGiftTimes,
          ...(isDirect ? { existingCustomerUserId: owner.id } : { dispatcherUserId: dispatcher.id }),
        };
        const order = await post(app, createRoute, creator, input);
        assert.deepEqual(await post(app, createRoute, creator, input), order);
        assert.equal(order.requestedGiftTimes, 100);
        assert.equal(order.estimatedReceivedHearts, expected);
        assert.equal((await orders.findOne({ _id: mongoId(order.id) })).heartDelivery.estimatedReceivedHearts, expected);
        await post(app, createRoute, creator, { ...input, estimatedReceivedHearts: expected }, 409);

        const pricingInput = { ...draftInput, giftSegments: segments, unlock };
        const prepared = await savePrice(order, pricingInput);
        const customerQuote = await get('client', customerRoute(order.id), owner);
        assert.equal(customerQuote.estimatedReceivedHearts, expected);
        assert.deepEqual(customerQuote.quote, prepared.quote);
        const totalAmountCents = heartsAmountCents + 100;
        assert.deepEqual(prepared.quote, {
          revision: 1, priceUnit: 'gift_times', giftSegments: segments, segments: [], unlockRateVersion: 1,
          unlock, heartsAmountCents, unlockAmountCents: 100, totalAmountCents,
        });

        const receiptsRoute = route(order) + '/receipts';
        const receiptInput = {
          requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: totalAmountCents,
          receivedAt: '2026-11-24T11:40:00Z',
        };
        await post('employee', receiptsRoute, executor, receiptInput, 404);
        const [edit, receipt] = await Promise.all([
          savePrice(order, { ...pricingInput, expectedRevision: 1 }, [200, 409]),
          post('employee', receiptsRoute, dispatcher, receiptInput, [201, 409]),
        ]);
        assert.notEqual(Boolean(edit), Boolean(receipt));
        if (edit) receiptInput.pricingRevision = 2;
        const paid = await post('employee', receiptsRoute, dispatcher, receiptInput);
        assert.deepEqual(await post('employee', receiptsRoute, dispatcher, receiptInput), paid);
        assert.equal(paid.paymentStatus, 'paid_in_full');
        assert.equal(paid.receipt.receivedByUserId, dispatcher.id);
        assert.equal(paid.receipt.recordedByUserId, dispatcher.id);
        assert.ok(Number.isFinite(Date.parse(paid.receipt.recordedAt)));
        assert.deepEqual(paid.receipt.quote, edit?.quote ?? prepared.quote);
        await savePrice(order, { ...pricingInput, expectedRevision: receiptInput.pricingRevision, unlock: { ...unlock, quantity: 2 } }, 409);
        const persisted = await orders.findOne({ _id: mongoId(order.id) });
        assert.deepEqual(persisted.receipt.quote, paid.receipt.quote);
        const customer = await get('client', customerRoute(order.id), owner);
        assert.equal(customer.estimatedReceivedHearts, expected);
        assert.deepEqual(customer.quote, paid.receipt.quote);
        assert.deepEqual(customer.receipt, { receivedAmountCents: totalAmountCents, receivedAt: '2026-11-24T11:40:00.000Z' });
        assert.equal(customer.pricing, undefined);
        assert.equal(customer.dispatchPricing, undefined);
        await get('client', customerRoute(order.id), stranger, 404);
        const published = await post('employee', route(order) + '/publish', dispatcher, {
          requestId: randomUUID(), pricingRevision: receiptInput.pricingRevision, ruleVersion: 1, commissionReviewRevision: 0,
        });
        assert.equal(published.dispatchStatus, 'published');
        assert.deepEqual((await get('client', customerRoute(order.id), owner)).quote, paid.receipt.quote);
      }
      const input = { ...orderInput(), dispatcherUserId: dispatcher.id, deliveryPeriodPreference: 'split' };
      const unknown = await post('client', clientOrders, owner, input);
      assert.equal(unknown.estimatedReceivedHearts, undefined);
      assert.equal((await post('client', clientOrders, owner, { ...input, requestId: randomUUID(), estimatedReceivedHearts: 163, doubleGiftTimes: 60 })).estimatedReceivedHearts, 163);
      await post('client', clientOrders, owner, { ...input, requestId: randomUUID(), doubleGiftTimes: 100 }, 400);
      await post('client', clientOrders, owner, { ...input, requestId: randomUUID(), requestedGiftTimes: Number.MAX_SAFE_INTEGER, deliveryPeriodPreference: 'double' }, 400);
      await savePrice(unknown, { ...draftInput, unlock: { quantity: Number.MAX_SAFE_INTEGER, unitPriceCents: 1 } }, 400);
      await savePrice(unknown, { ...draftInput, unlock });
      const shortage = await post('employee', route(unknown) + '/receipts', dispatcher, {
        requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 5000, receivedAt: '2026-11-24T11:40:00Z',
      });
      assert.equal(shortage.paymentStatus, 'underpaid');
      await post('employee', route(unknown) + '/publish', dispatcher, {
        requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
      }, 409);
    });

    await patch('employee', pricingRoute(draft), executor, draftInput, 404);
    await patch('employee', pricingRoute(draft), outsider, draftInput, 403);
    await patch('employee', pricingRoute(client), owner, draftInput, 403);
    for (const invalid of [
      { clubFeeCents: 99 }, { basis: 'received_hearts' }, { dispatchFeeCents: -1 }, { giftSegments: [null] },
      { segments: [{ period: 'normal', hearts: 100, unitPriceCents: 50 }] },
      { giftSegments: [{ ...giftSegments[0], dailyGiftTimes: 101 }] },
      { giftSegments: [{ ...giftSegments[0], paidGiftTimes: 99 }] },
      { giftSegments: [{ ...giftSegments[0], unitPriceCents: 35.1 }] },
      { giftSegments: [{ ...giftSegments[0], unitPriceCents: Number.MAX_SAFE_INTEGER }] },
    ]) await savePrice(draft, { ...draftInput, ...invalid }, 400);
    const prepared = await savePrice(draft);
    assert.equal(prepared.dispatchPricing, null);
    assert.equal(prepared.pricing.priceUnit, 'gift_times');
    assert.deepEqual(prepared.pricing.giftSegments, giftSegments);
    assert.deepEqual(await get('employee', pricingRoute(draft), dispatcher), prepared);
    assert.equal((await orders.findOne({ _id: mongoId(draft.id) })).dispatchPricing, undefined);
    await savePrice(draft, draftInput, 409);
    const clientPrepared = await savePrice(client, { ...draftInput, basis: 'gift_times', giftSegments: doubleSegments });
    assert.equal(clientPrepared.dispatchStatus, 'pending');
    await savePrice(unreviewed);
    const continuation = { requestId: randomUUID(), segment: { period: 'double', paidGiftTimes: 20, dailyGiftTimes: 5, unitPriceCents: 60 } };
    const extend = (order, input = continuation, status = 201, actor = dispatcher) =>
      post('employee', route(order) + '/continuation-quotes', actor, input, status);
    await extend(draft, continuation, 409);
    assert.equal(prepared.quote.totalAmountCents, 5000);
    assert.equal(clientPrepared.quote.totalAmountCents, 5000);
    const receipt = (order, amount, requestId = randomUUID(), status = 201, actor = dispatcher) =>
      post('employee', route(order) + '/receipts', actor, {
        requestId, pricingRevision: 1, receivedAmountCents: amount, receivedAt: '2026-11-24T11:40:00Z',
      }, status);
    const attemptPublish = (order, requestId, pricingRevision, ruleVersion, status = 201, extra = {}, actor = dispatcher) =>
      post('employee', route(order) + '/publish', actor, {
        requestId, pricingRevision, ruleVersion, commissionReviewRevision: 0, ...extra,
      }, status);

    const initialRequest = randomUUID();
    await attemptPublish(draft, initialRequest, 1, 1, 409);
    await receipt(draft, 5000, initialRequest, 404, executor);
    const [payment, paymentReplay] = await Promise.all([receipt(draft, 5000, initialRequest), receipt(draft, 5000, initialRequest)]);
    assert.deepEqual(payment, paymentReplay);
    assert.equal(payment.paymentStatus, 'paid_in_full');
    assert.equal(payment.receipt.receivedAt, '2026-11-24T11:40:00.000Z');
    assert.equal(payment.receipt.quote.totalAmountCents, 5000);
    assert.equal(payment.receipt.quote.heartsAmountCents, 5000);
    assert.equal(payment.receipt.quote.unlockAmountCents, 0);
    assert.deepEqual(payment.receipt.quote.unlock, { quantity: 0, unitPriceCents: 10 });
    assert.deepEqual(payment.receipt.quote.segments, []);
    assert.deepEqual(payment.receipt.quote.giftSegments, giftSegments);
    await receipt(draft, 5001, initialRequest, 409);
    await savePrice(draft, { ...draftInput, expectedRevision: 1 }, 409);
    await attemptPublish(draft, initialRequest, 1, 1, 400, { publicHearts: 100, directed: [] });
    await attemptPublish(draft, initialRequest, 1, 1, 404, {}, executor);
    assert.equal((await receipt(client, 4999)).paymentStatus, 'underpaid');
    await attemptPublish(client, randomUUID(), 1, 1, 409);
    await receipt(unreviewed, 5000);

    const publishIds = new Map([[draft.id, initialRequest]]);
    const publish = async (order, revision, version, count = 1) => {
      const status = order.id === unreviewed.id ? 409 : 201;
      const requestId = publishIds.get(order.id) ?? randomUUID();
      publishIds.set(order.id, requestId);
      const results = await Promise.all(Array.from({ length: count }, () => attemptPublish(order, requestId, revision, version, status)));
      return results.map(result => status === 409 ? { status: 409 } : result);
    };
    const [first, concurrent] = await publish(draft, 1, 1, 2);
    assert.deepEqual(first, concurrent);
    assert.equal(first.dispatchStatus, 'published');
    const { dispatchPricing: firstPricing } = first;
    assert.deepEqual({ version: firstPricing.version, clubFeeCents: firstPricing.clubFeeCents,
      dispatchFeeCents: firstPricing.dispatchFeeCents, basis: firstPricing.basis }, { ...versionOne, dispatchFeeCents: 5 });
    const saved = await orders.findOne({ _id: mongoId(draft.id) });
    assert.equal(saved.publishedAt.toISOString(), first.publishedAt);
    assert.deepEqual(saved.dispatchPricing, firstPricing);
    assert.equal(saved.pricing, undefined);
    assert.equal(saved.allocation, undefined);
    await savePrice(draft, { ...draftInput, expectedRevision: 1 }, 409);

    const versionTwo = await saveRule({ expectedVersion: 1, clubFeeCents: 7 });
    assert.deepEqual(versionTwo, { ...versionOne, version: 2, clubFeeCents: 7 });
    await extend(draft, continuation, 404, executor);
    await extend(draft, { ...continuation, clubFeeCents: 70 }, 400);
    const [renewal, replay] = await Promise.all([extend(draft), extend(draft)]);
    assert.deepEqual(renewal, replay);
    assert.deepEqual(renewal.commission, { ...versionOne, dispatchFeeCents: 5 });
    assert.equal(renewal.amountCents, 1200);
    await extend(draft, { ...continuation, segment: { ...continuation.segment, unitPriceCents: 65 } }, 409);
    assert.deepEqual((await orders.findOne({ _id: mongoId(draft.id) })).dispatchPricing, firstPricing);
    assert.equal((await orders.findOne({ _id: mongoId(draft.id) })).continuationQuotes.length, 1);
    assert.deepEqual((await publish(draft, 1, 1))[0], first);
    assert.equal((await publish(unreviewed, 1, 1))[0].status, 409);
    assert.equal((await publish(unreviewed, 1, 2))[0].status, 409);
    await attemptPublish(draft, initialRequest, 1, 2, 409);
    await attemptPublish(draft, randomUUID(), 1, 1, 409);
    const reviewRoute = route(unreviewed) + '/dispatch-commission';
    const review = { pricingRevision: 1, expectedReviewRevision: 0, ruleVersion: 2, dispatchFeeCents: 6 };
    await patch('employee', reviewRoute, executor, review, 404);
    await patch('employee', reviewRoute, dispatcher, { ...review, ruleVersion: 1 }, 409);
    assert.equal((await patch('employee', reviewRoute, dispatcher, review)).commissionReview.revision, 1);
    const reviewed = await attemptPublish(unreviewed, randomUUID(), 1, 2, 201, { commissionReviewRevision: 1 });
    assert.equal(reviewed.dispatchPricing.dispatchFeeCents, 6);
    assert.equal(reviewed.dispatchPricing.clubFeeCents, 7);

    const next = await makeDirect();
    await savePrice(next, { ...draftInput, ruleVersion: 2, dispatchFeeCents: 3 });
    await receipt(next, 5000);

    const [second] = await publish(next, 1, 2);
    assert.equal(second.dispatchPricing.version, 2);
    assert.equal(second.dispatchPricing.clubFeeCents, 7);
    assert.equal(second.dispatchPricing.dispatchFeeCents, 3);

    const clientView = await get('client', `${clientOrders}/${draft.id}`, owner);
    assert.equal(clientView.dispatchStatus, 'published');
    assert.equal(clientView.dispatchPricing, undefined);
    assert.equal(clientView.pricing, undefined);
    assert.equal(clientView.receipt.requestId, undefined);
    assert.equal(clientView.receipt.receivedAmountCents, 5000);
    assert.equal(clientView.continuationQuotes[0].commission, undefined);
    assert.equal(clientView.continuationQuotes[0].amountCents, 1200);
    await get('client', `${clientOrders}/${draft.id}`, stranger, 404);
    assert.equal((await get('client', `${clientOrders}/${client.id}`, owner)).estimatedReceivedHearts, 200);

    const legacyInput = { recipientGameAccount: '历史颗数', requestId: randomUUID(), requestedHearts: 175, dispatcherUserId: dispatcher.id };
    await post('client', clientOrders, owner, legacyInput, 400);
    const historical = [];
    for (const [index, basis] of ['received_hearts', 'gift_times'].entries()) {
      const historicalInput = { ...legacyInput, requestId: randomUUID() };
      const price = { basis, version: index + 2, revision: 1, dispatchFeeCents: 2, clubFeeCents: 4,
        segments: [{ period: 'double', hearts: 175, unitPriceCents: 21 }], unlock: { quantity: 2, unitPriceCents: 10 } };
      const now = new Date();
      const inserted = await orders.insertOne({
        requestId: historicalInput.requestId, source: 'client_order', clubId: 'main', businessType: 'heart_delivery',
        recipientGameAccount: historicalInput.recipientGameAccount, customerUserId: owner.id, customerLinkStatus: 'verified',
        createdByUserId: owner.id, dispatcherUserId: dispatcher.id, dispatcherAssignment: 'customer_selected',
        dispatchStatus: 'published', publishedAt: now, createdAt: now, shares: [],
        heartDelivery: { requestedHearts: 175 }, dispatchPricing: price,
      });
      const legacy = { id: String(inserted.insertedId) };
      historical.push({ ...legacy, price });
      const retained = await post('client', clientOrders, owner, historicalInput);
      assert.equal(retained.id, legacy.id);
      assert.equal(retained.requestedHearts, 175);
      assert.equal(retained.requestedGiftTimes, undefined);
      await post('client', clientOrders, owner, { ...historicalInput, requestedHearts: 170 }, 409);
      assert.deepEqual((await get('employee', pricingRoute(legacy), dispatcher)).dispatchPricing, price);
      const { quote } = await get('client', `${clientOrders}/${legacy.id}`, owner);
      assert.equal(quote.priceUnit, undefined);
      assert.deepEqual(quote.segments, price.segments);
      assert.equal(quote.heartsAmountCents, 3675);
      assert.equal(quote.totalAmountCents, 3695);
      await extend(legacy, continuation, 409);
    }

    await grant('CLUB_ORDERS_READ');
    const basic = (await adminGet(historyRoute)).items;
    assert.ok(basic.every(row => row.segments === undefined && row.giftSegments === undefined && row.dispatchFeeCents === undefined));
    await grant('CLUB_FINANCE_READ');
    const history = (await adminGet(historyRoute)).items;
    assert.deepEqual(history.find(row => row.id === draft.id).giftSegments, giftSegments);
    for (const { id, price } of historical) {
      const retained = history.find(row => row.id === id);
      assert.equal(retained.basis, price.basis);
      assert.equal(retained.priceUnit, undefined);
      assert.deepEqual(retained.segments, price.segments);
    }
    await revoke('CLUB_COMMISSION_MANAGE');
    await adminGet(ruleRoute, 403);
    await adminGet(historyRoute, 403);
  });

  await t.test('待分配订单按俱乐部职务处理，与客户取消原子互斥', async () => {
    const customerRoute = '/client/clubs/empty/orders';
    const staffRoute = '/employee/clubs/empty/orders';
    const queue = staffRoute + '/pending-assignment';
    const candidates = '/employee/clubs/empty/assignment-candidates';
    const assignRoute = (id) => `${staffRoute}/${id}/assign-dispatcher`;
    const cancelRoute = (id) => `${customerRoute}/${id}/cancel-before-assignment`;
    await member('empty', dispatcher, 'active', 'member');
    await member('empty', executor, 'active', 'member');
    await member('empty', adminEmployee, 'active', 'member');
    await configure('grant', 'empty', adminEmployee.id, 'CLUB_MEMBERS_MANAGE');
    await configure('position', 'empty', dispatcher.id, 'leader');
    await configure('position', 'empty', executor.id, 'deputy');
    assert.deepEqual((await get('client', '/client/clubs/empty/order-options', owner)).dispatchers, []);

    const input = { ...orderInput(31), deliveryPeriodPreference: 'split', doubleGiftTimes: 6 };
    const cancelInput = { ...orderInput(17), deliveryPeriodPreference: 'double' };
    const pending = await post('client', customerRoute, owner, input);
    const cancellable = await post('client', customerRoute, owner, cancelInput);
    assert.equal(pending.dispatchStatus, 'pending_assignment');
    assert.equal(pending.dispatcherUserId, null);
    assert.equal(pending.dispatcherAssignment, null);
    assert.equal(pending.estimatedReceivedHearts, 37);
    assert.equal(pending.publishedAt, null);
    assert.deepEqual(await post('client', customerRoute, owner, input), pending);
    await get('employee', queue, adminEmployee, 403);
    await get('employee', candidates, outsider, 403);
    await get('employee', `${staffRoute}/${pending.id}/pricing`, executor, 404);
    await get('client', `${customerRoute}/${pending.id}`, stranger, 404);
    await post('client', cancelRoute(pending.id), stranger, { requestId: randomUUID() }, 404);
    const assignment = { requestId: randomUUID(), dispatcherUserId: executor.id };
    await post('employee', assignRoute(pending.id), adminEmployee, assignment, 403);
    await post('employee', assignRoute(pending.id), dispatcher, { ...assignment, dispatcherUserId: outsider.id }, 400);
    assert.deepEqual(new Set((await get('employee', queue, executor)).items.map(({ id }) => id)), new Set([pending.id, cancellable.id]));

    await member('empty', dispatcher, 'active', 'dispatcher');
    assert.equal((await get('employee', candidates, dispatcher))[0].userId, dispatcher.id);
    assert.deepEqual(await post('client', customerRoute, owner, input), pending);
    const assigned = await post('employee', assignRoute(pending.id), dispatcher, assignment);
    assert.equal(assigned.dispatchStatus, 'pending');
    assert.equal(assigned.dispatcherAssignment, 'manual');
    assert.equal(assigned.dispatcherUserId, executor.id);
    assert.equal(assigned.decidedByUserId, dispatcher.id);
    assert.ok(Number.isFinite(Date.parse(assigned.decidedAt)));
    assert.deepEqual(await post('employee', assignRoute(pending.id), dispatcher, assignment), assigned);
    await api('employee', assignRoute(pending.id), {
      method: 'POST', token: executor.token, body: assignment, status: 409, message: /已有派单人/,
    });
    await post('employee', assignRoute(pending.id), dispatcher, { ...assignment, dispatcherUserId: dispatcher.id }, 409);
    await post('client', cancelRoute(pending.id), owner, { requestId: randomUUID() }, 409);
    await get('employee', `${staffRoute}/${pending.id}/pricing`, executor);
    await get('employee', `${staffRoute}/${pending.id}/pricing`, dispatcher, 404);
    const replayed = await post('client', customerRoute, owner, input);
    assert.equal(replayed.id, pending.id);
    assert.equal(replayed.dispatcherUserId, executor.id);
    assert.equal(replayed.source, 'client_order');
    assert.equal((await membership.findOne({ clubId: 'empty', userId: executor.id })).dispatcher, false);

    const cancellation = { requestId: randomUUID() };
    const cancelled = await post('client', cancelRoute(cancellable.id), owner, cancellation);
    assert.equal(cancelled.dispatchStatus, 'cancelled');
    assert.deepEqual(await post('client', cancelRoute(cancellable.id), owner, cancellation), cancelled);
    await post('client', cancelRoute(cancellable.id), owner, { requestId: randomUUID() }, 409);
    await api('employee', assignRoute(cancellable.id), {
      method: 'POST', token: executor.token, body: assignment, status: 409, message: /已由老板取消/,
    });
    assert.equal((await post('client', customerRoute, owner, cancelInput)).dispatchStatus, 'cancelled');
    assert.deepEqual((await get('employee', queue, dispatcher)).items, []);

    await member('empty', dispatcher, 'active', 'member');
    const competing = await post('client', customerRoute, owner, orderInput(11));
    const competingAssignment = { requestId: randomUUID(), dispatcherUserId: dispatcher.id };
    const [placed, withdrawn] = await Promise.all([
      post('employee', assignRoute(competing.id), executor, competingAssignment, [201, 409]),
      post('client', cancelRoute(competing.id), owner, cancellation, [201, 409]),
    ]);
    assert.equal(Number(!!placed) + Number(!!withdrawn), 1);
    const last = await orders.findOne({ _id: mongoId(competing.id) });
    assert.equal(last.pendingAssignmentDecision.kind, placed ? 'assigned' : 'cancelled');
    assert.equal(last.pendingAssignmentDecision.requestId, placed ? competingAssignment.requestId : cancellation.requestId);
    assert.equal(last.customerUserId, owner.id);
    assert.equal(last.createdByUserId, owner.id);
    assert.equal(last.publishedAt, undefined);
    assert.equal(last.receipt, undefined);
    assert.deepEqual(last.shares, []);
    if (placed) {
      assert.deepEqual(await post('employee', assignRoute(competing.id), executor, competingAssignment), placed);
    } else {
      assert.deepEqual(await post('client', cancelRoute(competing.id), owner, cancellation), withdrawn);
    }
    await configure('position', 'empty', executor.id, 'member');
    await get('employee', queue, executor, 403);
  });
});
