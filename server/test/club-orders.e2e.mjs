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
  const role = await db.collection('roles').findOne({ role_code: 'employee' });
  assert.ok(role);
  const register = async (username, app) => {
    await api('client', '/captcha/register?app=client');
    const account = await api('client', '/user/register?type=account', {
      method: 'POST', status: 201, body: { app: 'client', username, password, captcha: captchaCode },
    });
    if (app === 'employee') {
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
    for (const field of ['clubId', 'source', 'businessType', 'customerUserId', 'createdByUserId', 'dispatcherUserId', 'dispatchStatus', 'publishedAt', 'shares']) {
      await post('employee', employeeOrders, dispatcher, { ...orderInput(), [field]: owner.id }, 400);
    }
    const input = { ...orderInput(50), customerLabel: owner.id };
    direct = await post('employee', employeeOrders, dispatcher, input);
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

  await t.test('同一共享订单按派接职责读取；已核实的直接单仅向所属客户展示', async () => {
    // 模拟已由后续流程发布、承接或核实客户的持久化状态。上面的建单均通过正式 HTTP 入口。
    const { ClubOrderSchema } = require('../dist/src/modules/club/club-order.schema.js');
    const OrderFixture = mongoose.model('ClubOrderFixture', ClubOrderSchema);
    const publishFixture = async (order, actor, ...accounts) => {
      const key = { _id: mongoId(order.id) };
      const fixture = OrderFixture.hydrate(await orders.findOne(key));
      fixture.dispatchStatus = 'published';
      fixture.publishedAt = new Date();
      fixture.shares.push({ userId: actor.id, hearts: 50, executionGameAccounts: accounts.map((name) => ({ name })) });
      await fixture.validate();
      await orders.replaceOne(key, fixture.toObject());
    };
    await publishFixture(direct, executor, '同名送心号', '同名送心号');
    await publishFixture(selected, dispatcher, '团员甲游戏号');

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
    assert.equal(first.shares[0].executionGameAccounts, undefined);
    assert.equal(second.customerUserId, undefined);
    assert.equal(second.customerLabel, undefined);
    const reversed = await get('employee', `${employeeOrders}/${selected.id}`, dispatcher);
    assert.deepEqual(reversed.shares[0].executionGameAccounts.map((account) => account.name), ['团员甲游戏号']);
    assert.equal(reversed.source, 'client_order');
    assert.equal(reversed.customerUserId, undefined);
    assert.equal((await get('employee', `${employeeOrders}/${selected.id}`, executor)).customerUserId, owner.id);

    await orders.updateOne({ _id: mongoId(direct.id) }, { $set: { customerUserId: owner.id } });
    await get('client', `${clientOrders}/${direct.id}`, owner, 404);
    await orders.updateOne({ _id: mongoId(direct.id) }, { $set: { customerLinkStatus: 'verified' } });
    assert.deepEqual((await get('client', `${clientOrders}?source=direct_dispatch`, owner)).items.map((order) => order.id), [direct.id]);
    assert.deepEqual(new Set((await get('client', `${clientOrders}?source=client_order`, owner)).items.map((order) => order.id)), new Set([random.id, selected.id]));
    const clientView = await get('client', `${clientOrders}/${direct.id}`, owner);
    assert.equal(clientView.customerLabel, undefined);
    assert.equal(clientView.shares, undefined);
    await get('client', `${clientOrders}/${direct.id}`, stranger, 404);

    await member('main', executor, 'inactive', 'dispatcher');
    await get('employee', `${employeeOrders}/${direct.id}`, executor, 403);
    await post('client', clientOrders, owner, { ...orderInput(), dispatcherUserId: executor.id }, 400);
    assert.equal((await post('client', clientOrders, owner, { ...orderInput(), dispatcherUserId: dispatcher.id })).dispatcherUserId, dispatcher.id);
  });
  await checkDirectCustomers(t, { db, api, configure, register, dispatcher, outsider });
});
