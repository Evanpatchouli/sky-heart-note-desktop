import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { Types } from 'mongoose';
import { startClubSystem } from './club-test-system.mjs';

async function eventually(description, check) {
  const deadline = Date.now() + 20_000;
  do {
    if (await check()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  assert.fail(description);
}

test('按次正式派发的全团站内通知按发布名单去重、分页和恢复', { timeout: 180_000 }, async (t) => {
  const { db, api, administrator, login, register, seedClub, restartServer, startPeer } = await startClubSystem(t, {
    database: 'club_dispatch_notice_e2e',
    adminUsername: 'notice_admin',
  });
  const dispatcher = await register('notice_dispatcher', 'employee');
  const directedMember = await register('notice_directed', 'employee');
  const unmarked = await register('notice_unmarked', 'employee');
  const inactive = await register('notice_inactive', 'employee');
  const disabled = await register('notice_disabled', 'employee');
  const downgraded = await register('notice_downgraded', 'employee');
  const outsider = await register('notice_outsider', 'employee');
  const customer = await register('notice_customer', 'client');
  const adminEmployee = await login('employee', 'notice_admin');

  await seedClub('name', '送心俱乐部');
  const assign = (user, active = 'active', mark = 'member') =>
    seedClub('member', user.id, active, mark);
  await assign(dispatcher, 'active', 'dispatcher');
  for (const member of [directedMember, unmarked, disabled, downgraded, administrator]) await assign(member);
  await assign(inactive, 'inactive');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');
  await db.collection('users').updateOne({ _id: disabled.id }, { $set: { status: 0 } });
  const commonRole = await db.collection('roles').findOne({ role_code: 'common' });
  assert.ok(commonRole);
  await api('admin', '/admin/user-manage/' + downgraded.id + '/roles', {
    method: 'PUT', token: administrator.token, body: { roleIds: [String(commonRole._id)] },
  });
  const members = [administrator, dispatcher, directedMember, unmarked];
  const expected = members.map(({ id }) => id).sort();

  const orders = db.collection('club_orders');
  const records = db.collection('club_dispatch_notices');
  const inbox = '/employee/dispatch-notices';
  const club = '/employee/club';
  const preparationNotices = club + '/client-order-notices';
  const orderRoute = order => club + '/orders/' + order.id;
  const stored = order => orders.findOne({ _id: new Types.ObjectId(order.id) });
  const request = (app, path, user, method = 'GET', body, status = 200, server) =>
    api(app, path, { token: user?.token, method, body, status, server });
  const employee = (path, ...args) => request('employee', path, ...args);
  const readNotice = (noticeId, actor, status = 200) =>
    employee(inbox + '/' + noticeId + '/read', actor, 'PATCH', undefined, status);
  const orderInput = () => ({
    requestId: randomUUID(), recipientGameAccount: '测试用私有游戏账号', requestedGiftTimes: 20,
  });
  const window = { startDate: '2026-11-16', endDate: '2026-11-25' };
  const publicationInput = (openToClaim, directed = []) => ({
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, ...window, openToClaim, directed }],
  });
  const publish = (order, input, status = 201, actor = dispatcher, server) =>
    employee(orderRoute(order) + '/publish', actor, 'POST', input, status, server);

  async function prepare(order) {
    const pricing = await employee(orderRoute(order) + '/pricing', dispatcher, 'PATCH', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
      giftSegments: [{ period: 'normal', paidGiftTimes: 20, dailyGiftTimes: 2, unitPriceCents: 50 }],
    });
    assert.equal(pricing.quote.totalAmountCents, 1000);
    await employee(orderRoute(order) + '/receipts', dispatcher, 'POST', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 1000,
      receivedAt: '2026-11-24T19:40:00+08:00',
    }, 201);
  }

  await request('admin', '/admin/club/commission-rule', administrator, 'PATCH', {
    expectedVersion: 0, clubFeeCents: 5,
  });
  const direct = await employee(club + '/orders', dispatcher, 'POST', orderInput(), 201);
  const client = await request('client', '/client/orders', customer, 'POST', orderInput(), 201);
  assert.equal(direct.dispatchStatus, 'draft');
  assert.equal(client.dispatchStatus, 'pending');
  assert.equal(client.dispatcherAssignment, 'random');
  assert.equal(client.dispatcherUserId, dispatcher.id);
  assert.deepEqual((await employee(preparationNotices, dispatcher)).map(({ orderId }) => orderId), [client.id]);
  assert.deepEqual(await employee(preparationNotices, unmarked), []);

  const directedPublication = publicationInput(false, [{ userId: directedMember.id, dailyGiftTimes: 2, ...window }]);
  const clientPublication = publicationInput(true);
  await publish(direct, directedPublication, 409);
  await publish(client, clientPublication, 409);
  await publish(client, clientPublication, 404, unmarked);
  for (const actor of [dispatcher, directedMember, unmarked, inactive, outsider, adminEmployee]) {
    assert.deepEqual(await employee(inbox, actor), { items: [], hasUnread: false, nextCursor: null });
  }
  await employee(inbox, undefined, 'GET', undefined, 401);
  await employee(inbox, customer, 'GET', undefined, 403);
  await employee(inbox, administrator, 'GET', undefined, 403);
  await request('client', inbox, dispatcher, 'GET', undefined, 403);
  await employee(inbox, downgraded, 'GET', undefined, [401, 403]);
  await employee(inbox, disabled, 'GET', undefined, [401, 403]);
  assert.equal(await orders.countDocuments({ publication: { $exists: true } }), 0);
  assert.equal(await records.countDocuments(), 0);

  await prepare(direct);
  assert.equal(await records.countDocuments(), 0);
  await publish(direct, publicationInput(false, [{ userId: inactive.id, dailyGiftTimes: 2, ...window }]), 400);
  assert.equal((await stored(direct)).publication, undefined);
  const peer = await startPeer();
  const [directPublished, repeated] = await Promise.all([
    publish(direct, directedPublication), publish(direct, directedPublication, 201, dispatcher, peer),
  ]);
  assert.deepEqual(directPublished, repeated);
  assert.match(directPublished.publicationId, /^[a-f0-9]{24}$/);
  await publish(direct, { ...directedPublication, requestId: randomUUID() }, 409);
  const savedDirect = await stored(direct);
  assert.equal(savedDirect.dispatchStatus, 'published');
  assert.equal(savedDirect.publication.id.toHexString(), directPublished.publicationId);
  assert.equal(savedDirect.publication.clubId, 'club');
  assert.equal(savedDirect.publication.orderId.toHexString(), direct.id);
  assert.equal(savedDirect.publication.publishedAt.toISOString(), directPublished.publishedAt);
  assert.deepEqual(savedDirect.publication.recipientUserIds, expected);
  await eventually('直接单的全团通知应完成投递', async () => !(await stored(direct)).publication.pending);
  const directRecords = await records.find({ orderId: savedDirect._id }).toArray();
  assert.deepEqual(directRecords.map(({ recipientUserId }) => recipientUserId).sort(), expected);
  for (const record of directRecords) {
    assert.equal(record.targetApp, 'employee');
    assert.equal(record.type, 'important');
  }

  const unmarkedInbox = await employee(inbox, unmarked);
  assert.equal(unmarkedInbox.hasUnread, true);
  const unmarkedNotice = unmarkedInbox.items[0];
  assert.equal(unmarkedNotice.orderId, direct.id);
  assert.equal(unmarkedNotice.type, 'important');
  assert.equal(unmarkedNotice.targetApp, 'employee');
  assert.equal(unmarkedNotice.recipientGameAccount, undefined);
  assert.equal((await employee(inbox, adminEmployee)).items[0].orderId, direct.id);
  await readNotice(unmarkedNotice.id, directedMember, 404);
  await readNotice(unmarkedNotice.id, outsider, 404);
  await employee(inbox + '?recipientUserId=' + unmarked.id, outsider, 'GET', undefined, 400);
  await employee(inbox + '?limit=101', dispatcher, 'GET', undefined, 400);
  await employee(inbox + '?after=invalid', dispatcher, 'GET', undefined, 400);
  await employee(club + '/gift-claims/' + direct.id, unmarked, 'GET', undefined, 404);
  assert.equal((await employee(club + '/gift-claims/' + direct.id, directedMember)).id, direct.id);

  // MongoDB permits one insert from the unordered batch and rejects the rest.
  const clientOrderId = new Types.ObjectId(client.id);
  const validator = { $or: [{ orderId: { $ne: clientOrderId } }, { recipientUserId: dispatcher.id }] };
  await db.command({ collMod: records.collectionName, validator });
  await prepare(client);
  assert.equal((await stored(client)).publication, undefined);
  const clientPublished = await publish(client, clientPublication);
  assert.notEqual(clientPublished.publicationId, directPublished.publicationId);
  assert.deepEqual(await employee(preparationNotices, dispatcher), []);
  await eventually('部分写入后原事件应仍在待投递队列', async () => {
    const { publication } = await stored(client);
    return publication.pending && publication.nextAttemptAt > publication.publishedAt;
  });
  assert.equal(await records.countDocuments({ orderId: clientOrderId }), 1);
  assert.deepEqual((await stored(client)).publication.recipientUserIds, expected);

  const partialPage = await employee(inbox + '?limit=1', dispatcher);
  assert.equal(partialPage.items[0].orderId, client.id);
  assert.ok(partialPage.nextCursor);
  const olderPage = await employee(inbox + '?limit=1&after=' + partialPage.nextCursor, dispatcher);
  assert.equal(olderPage.items[0].orderId, direct.id);
  assert.equal(olderPage.nextCursor, null);
  assert.deepEqual(await employee(inbox + '/unread', dispatcher), { hasUnread: true });
  const marked = await readNotice(partialPage.items[0].id, dispatcher);
  assert.ok(Date.parse(marked.readAt));
  assert.deepEqual(await readNotice(marked.id, dispatcher), marked);
  await readNotice(olderPage.items[0].id, dispatcher);
  assert.deepEqual(await employee(inbox + '/unread', dispatcher), { hasUnread: false });

  await assign(unmarked, 'inactive');
  await assign(outsider);
  assert.deepEqual((await employee(inbox, unmarked)).items, []);
  await readNotice(unmarkedNotice.id, unmarked, 404);
  assert.deepEqual(await publish(client, clientPublication), clientPublished);
  await restartServer();
  await startPeer();
  await db.command({ collMod: records.collectionName, validator: {} });
  await eventually('重启后的后台应补齐原有快照并完成事件', async () => !(await stored(client)).publication.pending);
  const recovered = await records.find({ orderId: clientOrderId }).toArray();
  assert.deepEqual(recovered.map(({ recipientUserId }) => recipientUserId).sort(), expected);
  assert.ok((await stored(client)).publication.deliveredAt instanceof Date);
  assert.deepEqual(await readNotice(marked.id, dispatcher), marked);
  assert.deepEqual(await employee(inbox + '/unread', dispatcher), { hasUnread: false });
  assert.deepEqual((await employee(inbox, outsider)).items, []);
  assert.deepEqual((await employee(inbox, unmarked)).items, []);
  await assign(unmarked);
  const restoredPage = await employee(inbox, unmarked);
  assert.deepEqual(restoredPage.items.map(({ orderId }) => orderId), [client.id, direct.id]);
  const directedPage = await employee(inbox, directedMember);
  assert.notEqual(restoredPage.items[0].id, directedPage.items[0].id);
  assert.equal(directedPage.items[0].readAt, null);
  await assert.rejects(() => records.insertOne({
    publicationId: savedDirect.publication.id, recipientUserId: dispatcher.id,
  }), { code: 11000 });

  const legacyId = new Types.ObjectId();
  const { publication: _event, ...legacy } = savedDirect;
  await orders.insertOne({ ...legacy, _id: legacyId, requestId: randomUUID() });
  const oldPublication = await publish({ id: legacyId.toHexString() }, directedPublication);
  assert.equal(oldPublication.publicationId, undefined);
  assert.equal((await orders.findOne({ _id: legacyId })).publication, undefined);
  assert.equal(await records.countDocuments({ orderId: legacyId }), 0);
});
