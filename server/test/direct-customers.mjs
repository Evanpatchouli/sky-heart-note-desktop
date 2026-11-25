import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { captchaCode } from './start-system.mjs';

export async function checkDirectCustomers(t, { db, base, api, seedClub, register, dispatcher, outsider }) {
  const clubId = 'club';
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  const [ownerName, strangerName] = ['binding_first_customer', 'binding_second_customer'];
  const owner = await register(ownerName, 'client');
  const stranger = await register(strangerName, 'client');
  const employeeRoute = `/employee/club/orders`;
  const clientRoute = `/client/orders`;
  const users = db.collection('users');
  const orders = db.collection('club_orders');
  const common = await db.collection('roles').findOne({ role_code: 'common' });
  const nickname = '同名老板 [A]';
  const get = (app, path, actor, status = 200) => api(app, path, { token: actor?.token, status });
  const post = (app, path, actor, body, status = 201) => api(app, path, { method: 'POST', token: actor.token, body, status });
  const direct = (body, status) => post('employee', employeeRoute, dispatcher, body, status);
  const search = (q, actor = dispatcher, status) => get('employee',
    `/employee/club/order-customers?${new URLSearchParams({ q })}`, actor, status);
  const input = () => ({ requestId: randomUUID(), recipientGameAccount: '爱心接收游戏号', requestedGiftTimes: 13 });
  const ids = items => items.map(({ id }) => id);
  await users.updateMany({ _id: { $in: [owner.id, stranger.id] } }, { $set: { nickname } });

  await t.test('搜索用户名、昵称及四位 ID，只返回有效账号的最少字段', async () => {
    await search(nickname, outsider, 403);
    await search(nickname, owner, 403);
    await search('  ', dispatcher, 400);
    await search('汉'.repeat(101), dispatcher, 400);
    const statusFixtures = [
      { _id: 'H1AX', nickname, status: 0, deleted_at: null, role_ids: [common._id] },
      { _id: 'H1AY', nickname, status: 1, deleted_at: Date.now(), role_ids: [common._id] },
      { _id: 'H1AZ', nickname, status: 1, deleted_at: null, role_ids: [] },
      ...Array.from({ length: 21 }, (_, index) => ({
        _id: `Q${index.toString(36).toUpperCase().padStart(3, '0')}`,
        username: `other_${ownerName}_${index}`,
        status: 1,
        deleted_at: null,
        role_ids: [common._id],
      })),
    ];
    // Synthetic IDs are picked from free slots so a randomly allocated real fixture cannot collide.
    for (const fixture of statusFixtures) {
      while (await users.findOne({ _id: fixture._id })) {
        fixture._id = randomUUID().slice(0, 4).toUpperCase();
      }
      await users.insertOne(fixture);
    }
    assert.deepEqual((await search(ownerName))[0], { userId: owner.id, nickname });
    assert.equal((await search(ownerName)).length, 20);
    assert.deepEqual((await search(owner.id.toLowerCase()))[0], { userId: owner.id, nickname });
    assert.deepEqual(new Set((await search('[A]')).map(({ userId }) => userId)), new Set([owner.id, stranger.id]));
    assert.deepEqual(await search('.*'), []);
    assert.deepEqual(await search('$'), []);
    await direct({ ...input(), existingCustomerUserId: statusFixtures[0]._id }, 400);
    await direct({ ...input(), existingCustomerUserId: statusFixtures[1]._id }, 400);
    await direct({ ...input(), existingCustomerUserId: statusFixtures[2]._id }, 400);
    await direct({ ...input(), existingCustomerUserId: '坏ID' }, 400);
    await direct({ ...input(), newCustomerNickname: ' ' }, 400);
    await direct({ ...input(), existingCustomerUserId: owner.id, newCustomerNickname: nickname }, 400);
    await direct({ ...input(), customerLabel: nickname, existingCustomerUserId: owner.id }, 400);
    for (const fields of [{ existingCustomerUserId: stranger.id }, { newCustomerNickname: nickname }]) {
      await post('client', clientRoute, owner, { ...input(), ...fields }, 400);
    }
  });

  await t.test('已有老板能查本人两种来源多笔订单，历史称呼不产生客户归属', async () => {
    const linkedInput = { ...input(), existingCustomerUserId: owner.id };
    const [linked, repeat] = await Promise.all([direct(linkedInput), direct(linkedInput)]);
    assert.deepEqual(repeat, linked);
    assert.equal(linked.createdByUserId, dispatcher.id);
    assert.equal(linked.dispatcherUserId, dispatcher.id);
    assert.equal(linked.customerUserId, owner.id);
    assert.equal(linked.customerLinkStatus, 'verified');
    assert.equal(linked.recipientGameAccount, linkedInput.recipientGameAccount);
    await direct({ ...linkedInput, existingCustomerUserId: stranger.id }, 409);
    const second = await direct({ ...input(), existingCustomerUserId: owner.id });
    const own = await post('client', clientRoute, owner, input());
    const legacy = await direct({ ...input(), customerLabel: nickname });
    assert.equal(legacy.customerLinkStatus, 'pending_verification');
    assert.equal(legacy.customerUserId, null);
    assert.deepEqual(new Set(ids((await get('client', '/client/orders', owner)).items)), new Set([linked.id, second.id, own.id]));
    assert.deepEqual(new Set(ids((await get('client', `${clientRoute}?source=direct_dispatch`, owner)).items)), new Set([linked.id, second.id]));
    assert.deepEqual(ids((await get('client', `${clientRoute}?source=client_order`, owner)).items), [own.id]);
    assert.deepEqual((await get('client', '/client/orders', stranger)).items, []);
    assert.equal((await get('client', `${clientRoute}/${linked.id}`, owner)).id, linked.id);
    await get('client', `${clientRoute}/${linked.id}`, stranger, 404);
    await get('client', `${clientRoute}/${legacy.id}`, owner, 404);
  });

  await t.test('同一建号请求的分段写入失败和并发重试只留下一个关联订单与账号', async () => {
    const newNickname = '建号恢复 [测试]';
    const body = { ...input(), newCustomerNickname: newNickname };
    const key = { clubId, requestId: body.requestId };
    const validate = (collection, validator) => db.command({ collMod: collection, validator });
    await validate('club_orders', { requestId: { $ne: body.requestId } });
    try {
      await direct(body, 500);
      assert.equal(await orders.countDocuments(key), 0);
      assert.equal(await users.countDocuments({ nickname: newNickname }), 0);
    } finally {
      await validate('club_orders', {});
    }
    let pending;
    await validate('users', { nickname: { $ne: newNickname } });
    try {
      await direct(body, 500);
      pending = await orders.findOne(key);
      assert.ok(pending);
      assert.equal(pending.customerLinkStatus, 'pending_verification');
      assert.equal(await users.countDocuments({ nickname: newNickname }), 0);
      assert.ok(!ids((await get('employee', employeeRoute, dispatcher)).items).includes(String(pending._id)));
    } finally {
      await validate('users', {});
    }
    const accountKey = { dispatchCustomerOrderId: pending._id };
    let customer;
    await validate('club_orders', {
      $or: [{ requestId: { $ne: body.requestId } }, { customerLinkStatus: { $ne: 'verified' } }],
    });
    try {
      await direct(body, 500);
      customer = await users.findOne(accountKey);
      assert.match(customer._id, /^[A-Z0-9]{4}$/);
      assert.equal(customer.nickname, newNickname);
      assert.equal(customer.username, undefined);
      assert.equal(customer.password, undefined);
      assert.deepEqual(customer.role_ids, [common._id]);
      assert.deepEqual(await search(newNickname), []);
      assert.deepEqual(await search(customer._id), []);
      await get('employee', `${employeeRoute}/${pending._id}`, dispatcher, 404);
      await direct({ ...input(), existingCustomerUserId: customer._id }, 400);
      await direct({ ...body, newCustomerNickname: '竞争请求内容' }, 409);
      await direct({ ...input(), requestId: body.requestId, existingCustomerUserId: owner.id }, 409);
      assert.equal(await users.countDocuments(accountKey), 1);
    } finally {
      await validate('club_orders', {});
    }
    const replies = await Promise.all(Array.from({ length: 5 }, () => direct(body)));
    assert.ok(replies.every(order => order.id === String(pending._id) && order.customerUserId === customer._id
      && order.customerLinkStatus === 'verified'));
    assert.deepEqual(await direct(body), replies[0]);
    assert.equal(await orders.countDocuments(key), 1);
    assert.equal(await users.countDocuments(accountKey), 1);
    assert.deepEqual(await search(newNickname), [{ userId: customer._id, nickname: newNickname }]);
    assert.equal((await direct({ ...input(), existingCustomerUserId: customer._id })).customerUserId, customer._id);
  });

  await t.test('首次并发建号支持成功重放，重名新老板使用不同的真实四位账号', async () => {
    const body = { ...input(), newCustomerNickname: nickname };
    const replies = await Promise.all(Array.from({ length: 6 }, () => direct(body)));
    const [first] = replies;
    assert.ok(replies.every(({ id, customerUserId }) => id === first.id && customerUserId === first.customerUserId));
    assert.match(first.customerUserId, /^[A-Z0-9]{4}$/);
    assert.deepEqual(await direct(body), first);
    await direct({ ...body, requestedGiftTimes: 14 }, 409);
    const second = await direct({ ...input(), newCustomerNickname: nickname });
    assert.equal(new Set([owner.id, stranger.id, first.customerUserId, second.customerUserId]).size, 4);
    assert.equal(await users.countDocuments({ nickname, dispatchCustomerOrderId: { $exists: true } }), 2);
    assert.equal(await orders.countDocuments({ clubId, requestId: body.requestId }), 1);
    assert.deepEqual(new Set((await search(nickname)).map(({ userId }) => userId)),
      new Set([owner.id, stranger.id, first.customerUserId, second.customerUserId]));
  });

  await t.test('原派单人可交接一次性激活链接，老板沿用四位账号和历史订单', async () => {
    const newNickname = '待激活老板';
    const original = await direct({ ...input(), newCustomerNickname: newNickname });
    const followUp = await direct({ ...input(), existingCustomerUserId: original.customerUserId });
    const existing = await direct({ ...input(), existingCustomerUserId: owner.id });
    const issuePath = id => `${employeeRoute}/${id}/customer-activation`;
    const issue = (actor, id = original.id, status = 201) => api('employee', issuePath(id), {
      method: 'POST', token: actor?.token, status,
    });
    const credentials = { username: 'activated_boss', password: 'activated-boss-password' };
    const activationPath = '/user/activate-dispatch-customer';
    const redeem = async (token, fields = credentials, app = 'client') => {
      const response = await fetch(base + activationPath, {
        method: 'POST',
        headers: { origin: `https://${app}.club.test`, 'content-type': 'application/json' },
        body: JSON.stringify({ token, ...fields }),
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      return { status: response.status, message: result.message };
    };
    const unpack = ({ activationUrl, expiresAt }) => {
      const { origin, pathname, search, hash } = new URL(activationUrl);
      assert.equal(origin, 'https://client.club.test');
      assert.equal(pathname, '/activate');
      assert.equal(search, '');
      assert.ok(expiresAt > Date.now());
      const token = new URLSearchParams(hash.slice(1)).get('token');
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      return token;
    };
    const customerKey = { _id: original.customerUserId };
    const visible = async actor => (await get('employee', employeeRoute, actor)).items
      .filter(order => order.customerActivationAvailable).map(order => order.id);
    assert.ok((await visible(dispatcher)).includes(original.id));
    assert.ok(!(await visible(dispatcher)).includes(followUp.id));
    assert.ok(!(await visible(dispatcher)).includes(existing.id));
    await issue(undefined, original.id, 401);
    await issue(owner, original.id, 403);
    await issue(outsider, original.id, 403);
    await seedClub('member', outsider.id, 'active', 'dispatcher');
    await issue(outsider, original.id, 404);
    assert.ok(!(await visible(outsider)).includes(original.id));
    const otherDispatcherOrder = await post('employee', employeeRoute, outsider,
      { ...input(), existingCustomerUserId: original.customerUserId });
    await issue(outsider, otherDispatcherOrder.id, 409);
    await issue(dispatcher, followUp.id, 409);
    await issue(dispatcher, existing.id, 409);
    await api('employee', `/employee/clubs/side/orders/${original.id}/customer-activation`, {
      method: 'POST', token: outsider.token, status: 404,
    });

    const first = unpack(await issue(dispatcher));
    const expired = unpack(await issue(dispatcher));
    assert.notEqual(first, expired);
    assert.equal((await redeem(first)).status, 404);
    await users.updateOne(customerKey, { $set: { 'dispatchActivation.expiresAt': Date.now() - 1 } });
    assert.equal((await redeem(expired)).status, 410);
    const token = unpack(await issue(dispatcher));
    const pending = await users.findOne(customerKey);
    assert.equal(pending.dispatchActivation.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(pending.username, undefined);
    assert.equal(pending.password, undefined);
    assert.equal((await redeem(token, credentials, 'employee')).status, 403);
    assert.equal((await redeem('invalid')).status, 404);
    assert.equal((await redeem(token, { ...credentials, username: ' ' })).status, 400);

    await db.collection('roles').updateOne({ _id: common._id }, { $set: { status: 0 } });
    try {
      assert.equal((await redeem(token)).status, 403);
      await issue(dispatcher, original.id, 403);
      assert.ok(!(await visible(dispatcher)).includes(original.id));
    } finally {
      await db.collection('roles').updateOne({ _id: common._id }, { $set: { status: 1 } });
    }
    await users.updateOne(customerKey, { $set: { status: 0 } });
    assert.equal((await redeem(token)).status, 403);
    await users.updateOne(customerKey, { $set: { status: 1 } });

    const occupied = await redeem(token, { ...credentials, username: ` ${ownerName} ` });
    assert.equal(occupied.status, 409);
    assert.match(occupied.message, /用户名已被注册/);
    assert.equal((await users.findOne(customerKey)).dispatchActivation.usedAt, undefined);

    const attempts = await Promise.all([
      redeem(token), redeem(token, { ...credentials, username: 'racing_boss' }),
    ]);
    assert.deepEqual(attempts.map(({ status }) => status).sort(), [201, 409]);
    assert.match(attempts.find(({ status }) => status === 409).message, /激活链接已使用/);
    const replay = await redeem(token);
    assert.equal(replay.status, 409);
    assert.match(replay.message, /激活链接已使用/);
    await issue(dispatcher, original.id, 409);
    assert.ok(!(await visible(dispatcher)).includes(original.id));

    const updated = await users.findOne(customerKey);
    assert.equal(updated.nickname, newNickname);
    assert.deepEqual(updated.role_ids, [common._id]);
    assert.match(updated.password, /^scrypt\$/);
    assert.equal(await users.countDocuments({ nickname: newNickname }), 1);
    assert.equal((await users.findOne({ _id: owner.id })).username, ownerName);
    await api('client', '/captcha/login?app=client');
    const customer = await api('client', '/user/login?type=account', {
      method: 'POST', status: 201,
      body: { app: 'client', username: updated.username, password: credentials.password, captcha: captchaCode },
    });
    assert.equal(customer.id, original.customerUserId);
    assert.equal(customer.nickname, newNickname);
    assert.deepEqual(customer.roles, ['common']);
    assert.deepEqual(new Set(ids((await get('client', '/client/orders', customer)).items)),
      new Set([original.id, followUp.id, otherDispatcherOrder.id]));
    await get('client', `${clientRoute}/${existing.id}`, customer, 404);
    await seedClub('member', outsider.id, 'inactive', 'member');
  });
}
