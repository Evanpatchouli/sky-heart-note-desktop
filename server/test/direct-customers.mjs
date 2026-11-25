import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkDirectCustomers(t, { db, api, configure, register, dispatcher, outsider }) {
  const clubId = 'customer-binding';
  await configure('club', clubId, '客户绑定俱乐部');
  await configure('member', clubId, dispatcher.id, 'active', 'dispatcher');
  const [ownerName, strangerName] = ['binding_first_customer', 'binding_second_customer'];
  const owner = await register(ownerName, 'client');
  const stranger = await register(strangerName, 'client');
  const employeeRoute = `/employee/clubs/${clubId}/orders`;
  const clientRoute = `/client/clubs/${clubId}/orders`;
  const users = db.collection('users');
  const orders = db.collection('club_orders');
  const common = await db.collection('roles').findOne({ role_code: 'common' });
  const nickname = '同名老板 [A]';
  const get = (app, path, actor, status = 200) => api(app, path, { token: actor?.token, status });
  const post = (app, path, actor, body, status = 201) => api(app, path, { method: 'POST', token: actor.token, body, status });
  const direct = (body, status) => post('employee', employeeRoute, dispatcher, body, status);
  const search = (q, actor = dispatcher, status) => get('employee',
    `/employee/clubs/${clubId}/order-customers?${new URLSearchParams({ q })}`, actor, status);
  const input = () => ({ requestId: randomUUID(), recipientGameAccount: '爱心接收游戏号', requestedHearts: 13 });
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
    await direct({ ...body, requestedHearts: 14 }, 409);
    const second = await direct({ ...input(), newCustomerNickname: nickname });
    assert.equal(new Set([owner.id, stranger.id, first.customerUserId, second.customerUserId]).size, 4);
    assert.equal(await users.countDocuments({ nickname, dispatchCustomerOrderId: { $exists: true } }), 2);
    assert.equal(await orders.countDocuments({ clubId, requestId: body.requestId }), 1);
    assert.deepEqual(new Set((await search(nickname)).map(({ userId }) => userId)),
      new Set([owner.id, stranger.id, first.customerUserId, second.customerUserId]));
  });
}
