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
  const api = async (app, path, { method = 'GET', body, token, status = 200 } = {}) => {
    const headers = { origin: origin(app) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith('/user/') && challenges.has(app)) {
      headers.cookie = challenges.get(app);
      challenges.delete(app);
    }
    const response = await fetch(base + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
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
  const orderInput = (requestedHearts = 100) => ({ requestId: randomUUID(), recipientGameAccount: '接收游戏号', requestedHearts });
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
    await post('client', '/client/clubs/empty/orders', owner, orderInput(), 409);
    await post('client', '/client/clubs/missing/orders', owner, orderInput(), 404);
    assert.equal(await orders.countDocuments({ source: 'client_order' }), 0);
    const input = orderInput();
    const results = await Promise.all(Array.from({ length: 6 }, () => post('client', clientOrders, owner, input)));
    [random] = results;
    assert.ok(results.every((result) => result.id === random.id && result.dispatcherUserId === dispatcher.id));
    assert.equal(random.dispatcherAssignment, 'random');
    assert.equal(await orders.countDocuments({ source: 'client_order' }), 1);
    assert.equal((await post('client', clientOrders, owner, { ...input, requestId: input.requestId.toUpperCase() })).id, random.id);
    await post('client', clientOrders, owner, { ...input, requestedHearts: 99 }, 409);

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
    assert.equal(saved.heartDelivery.requestedHearts, 100);
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
});
