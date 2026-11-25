import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { Types } from 'mongoose';
import webPush from 'web-push';
import { startClubSystem } from './club-test-system.mjs';
import { captchaCode } from './start-system.mjs';

const gatewayOrigin = 'https://push.p1-27.invalid';
const contact = 'mailto:push-test@example.invalid';
const pushRoute = '/employee/dispatch-push';

function syntheticDevice(path, applicationServerKey) {
  const key = createECDH('prime256v1');
  const p256dh = key.generateKeys().toString('base64url');
  const auth = randomBytes(16);
  return {
    key, auth, path,
    body: { applicationServerKey, endpoint: gatewayOrigin + path, keys: { p256dh, auth: auth.toString('base64url') } },
  };
}

function decrypt(message, device) {
  const hmac = (key, ...parts) => createHmac('sha256', key).update(Buffer.concat(parts)).digest();
  const salt = message.subarray(0, 16);
  const publicKey = message.subarray(21, 21 + message[20]);
  const encrypted = message.subarray(21 + message[20]);
  const keyInfo = [Buffer.from('WebPush: info\0'), device.key.getPublicKey(), publicKey, Buffer.of(1)];
  const inputKey = hmac(hmac(device.auth, device.key.computeSecret(publicKey)), ...keyInfo);
  const secret = hmac(salt, inputKey);
  const expand = (purpose, length) =>
    hmac(secret, Buffer.from('Content-Encoding: ' + purpose + '\0'), Buffer.of(1)).subarray(0, length);
  const aes = createDecipheriv('aes-128-gcm', expand('aes128gcm', 16), expand('nonce', 12));
  aes.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([aes.update(encrypted.subarray(0, -16)), aes.final()]);
  assert.equal(plain.at(-1), 2);
  return JSON.parse(plain.subarray(0, -1));
}

function checkVapid({ authorization }, expectedPublicKey) {
  const match = /^vapid t=([^,]+), k=([\w-]+)$/.exec(authorization);
  assert.ok(match, 'RFC 8292 Authorization');
  const [, jwt, key] = match;
  assert.equal(key, expectedPublicKey);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.aud, gatewayOrigin);
  assert.equal(claims.sub, contact);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400);
  const bytes = Buffer.from(key, 'base64url');
  const publicKey = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: bytes.subarray(1, 33).toString('base64url'), y: bytes.subarray(33).toString('base64url') },
    format: 'jwk',
  });
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
}

async function eventually(description, check) {
  const expires = Date.now() + 25_000;
  do {
    const result = await check();
    if (result) return result;
    await sleep(65);
  } while (Date.now() < expires);
  assert.fail(description);
}

async function startGateway(t) {
  const vapid = webPush.generateVAPIDKeys();
  const calls = [];
  const responses = new Map();
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const publication = req.headers.topic;
    const key = `${publication}:${req.url}`;
    calls.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks), at: Date.now(), key });
    const { status = 201, retryAfter } = (responses.get(key) ?? responses.get(req.url))?.shift() ?? {};
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
    res.writeHead(status).end();
  }).listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(() => { gateway.close(); gateway.closeAllConnections(); });
  return {
    vapid, calls, responses,
    extraEnv: {
      WEB_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
      WEB_PUSH_VAPID_SUBJECT: contact,
      WEB_PUSH_ALLOWED_ORIGINS: gatewayOrigin,
    },
    extraFixtures: `
      // Replace the transport entirely. Even a failed assertion never calls a real gateway.
      const transport = require('./dist/src/modules/club/club-dispatch-push.transport.js');
      transport.postPushRequest = (details, signal) => {
        const endpoint = new URL(details.endpoint);
        if (endpoint.origin !== ${JSON.stringify(gatewayOrigin)}) throw new Error('Unexpected synthetic endpoint');
        return new Promise((resolve, reject) => {
          const req = require('node:http').request({
            hostname: '127.0.0.1', port: ${gateway.address().port}, path: endpoint.pathname + endpoint.search,
            method: details.method, headers: details.headers, signal,
          }, response => {
            response.resume();
            resolve({ statusCode: response.statusCode, headers: response.headers });
          });
          req.on('error', reject);
          req.end(details.body);
        });
      };
    `,
  };
}

test('正式派发通过 Web Push 加密投递，重启继续重试并隔离设备失效和账号切换', { timeout: 180_000 }, async t => {
  const { vapid, calls, responses, extraEnv, extraFixtures } = await startGateway(t);
  const { db, base, password, api, administrator, register, seedClub, restartServer, startPeer } = await startClubSystem(t, {
    database: 'club_dispatch_push_e2e', adminUsername: 'push_admin', extraEnv, extraFixtures,
  });

  const dispatcher = await register('push_dispatcher', 'employee');
  const first = await register('push_member', 'employee');
  const late = await register('push_late', 'employee');
  const outside = await register('push_outside', 'employee');
  const customer = await register('push_customer', 'client');
  await seedClub('name', '本地测试俱乐部');
  await seedClub('member', dispatcher.id, 'active', 'dispatcher');
  await seedClub('member', first.id, 'active', 'member');
  await seedClub('member', late.id, 'active', 'member');
  await seedClub('member', administrator.id, 'active', 'member');
  await seedClub('grant', administrator.id, 'CLUB_COMMISSION_MANAGE');

  let grant;
  async function employeeBrowserLogin(username) {
    const origin = 'https://employee.club.test';
    const captchaResponse = await fetch(base + '/captcha/login?app=employee', { headers: { origin } });
    assert.equal(captchaResponse.status, 200);
    const captcha = captchaResponse.headers.getSetCookie()
      .find(cookie => cookie.startsWith('sky_captcha_')).split(';')[0];
    const response = await fetch(base + '/user/login?type=account', {
      method: 'POST', headers: {
        origin, 'content-type': 'application/json', cookie: [captcha, grant].filter(Boolean).join('; '),
      },
      body: JSON.stringify({ app: 'employee', username, password, captcha: captchaCode }),
    });
    assert.equal(response.status, 201);
    grant = response.headers.getSetCookie().find(cookie => cookie.startsWith('sky_grant_employee=')).split(';')[0];
    return (await response.json()).data;
  }
  const second = await employeeBrowserLogin('push_member');
  const firstDevice = syntheticDevice('/v1/device-a', vapid.publicKey);
  const secondDevice = syntheticDevice('/v1/device-b', vapid.publicKey);
  const lateDevice = syntheticDevice('/?token=late', vapid.publicKey);
  const otherDevice = syntheticDevice('/v1/outside', vapid.publicKey);

  const employee = (path, actor, method = 'GET', body, status = 200) =>
    api('employee', path, { token: actor?.token, method, body, status });
  const enable = (actor, device, status = 200) => employee(pushRoute, actor, 'PUT', device.body, status);
  const subscriptions = db.collection('club_dispatch_push_subscriptions');
  const deliveries = db.collection('club_dispatch_push_deliveries');
  const notices = db.collection('club_dispatch_notices');
  const orders = db.collection('club_orders');
  const id = value => new Types.ObjectId(value);
  const jobs = publicationId => deliveries.find({ publicationId: id(publicationId) }).toArray();

  await employee(pushRoute, undefined, 'GET', undefined, 401);
  await employee(pushRoute, customer, 'GET', undefined, 403);
  assert.deepEqual(await employee(pushRoute, first), { publicKey: vapid.publicKey, fingerprint: null });
  for (const endpoint of ['http://127.0.0.1/push', 'https://[::1]/api', 'https://169.254.169.254/push',
    'https://push.p1-27.invalid@evil.invalid/', 'https://push.p1-27.invalid.bad.invalid/push',
    `${gatewayOrigin}/v1/fragment#secret`, `${gatewayOrigin}\\local`]) {
    await enable(first, { body: { ...firstDevice.body, endpoint } }, 400);
  }
  await enable(first, { body: { ...firstDevice.body, keys: { ...firstDevice.body.keys, p256dh: Buffer.concat([Buffer.of(4), Buffer.alloc(64)]).toString('base64url') } } }, 400);
  await enable(first, { body: { ...firstDevice.body, keys: { ...firstDevice.body.keys, auth: 'YQ' } } }, 400);
  await enable(first, { body: { ...firstDevice.body, applicationServerKey: 'stale' } }, 409);
  const firstStatus = await enable(first, firstDevice);
  const firstRecord = await subscriptions.findOne({ endpoint: firstDevice.body.endpoint });
  assert.deepEqual(await enable(first, firstDevice), firstStatus);
  assert.deepEqual(await subscriptions.findOne({ endpoint: firstDevice.body.endpoint }), firstRecord);
  assert.deepEqual(Object.keys(firstStatus).sort(), ['fingerprint', 'publicKey']);
  await enable(outside, syntheticDevice(firstDevice.path, vapid.publicKey), 409);
  await enable(outside, otherDevice);
  await enable(second, secondDevice);
  assert.equal(await subscriptions.countDocuments(), 3);

  const baseOrderRoute = '/employee/club/orders';
  const input = () => ({ requestId: randomUUID(), recipientGameAccount: '别把游戏账号放进提醒', requestedGiftTimes: 20 });
  await api('admin', '/admin/club/commission-rule', {
    token: administrator.token, method: 'PATCH',
    body: { expectedVersion: 0, basis: 'gift_times', clubFeeCents: 5 },
  });
  const direct = await employee(baseOrderRoute, dispatcher, 'POST', input(), 201);
  const customerOrder = await api('client', '/client/orders', {
    token: customer.token, method: 'POST', status: 201, body: { ...input(), dispatcherUserId: dispatcher.id },
  });
  const orderRoute = order => `${baseOrderRoute}/${order.id}`;
  const publishInput = () => ({
    requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1, commissionReviewRevision: 0,
    giftDispatchSegments: [{ segmentIndex: 0, startDate: '2026-11-24', endDate: '2026-12-03', openToClaim: true, directed: [] }],
  });
  const publish = (order, body, status = 201) =>
    employee(orderRoute(order) + '/publish', dispatcher, 'POST', body, status);
  await publish(direct, publishInput(), 409);
  await publish(customerOrder, publishInput(), 409);
  assert.equal(await deliveries.countDocuments(), 0);
  assert.equal(calls.length, 0);
  async function prepare(order) {
    await employee(orderRoute(order) + '/pricing', dispatcher, 'PATCH', {
      expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
      giftSegments: [{ period: 'normal', paidGiftTimes: 20, dailyGiftTimes: 2, unitPriceCents: 50 }],
    });
    await employee(orderRoute(order) + '/receipts', dispatcher, 'POST', {
      requestId: randomUUID(), pricingRevision: 1, receivedAmountCents: 1000, receivedAt: '2026-11-24T19:40:00+08:00',
    }, 201);
  }
  await prepare(direct);
  await db.command({ collMod: notices.collectionName, validator: { recipientUserId: dispatcher.id } });
  const directInput = publishInput();
  const directPublished = await publish(direct, directInput);
  await enable(late, lateDevice);
  responses.set(`${directPublished.publicationId}:${secondDevice.path}`, [{ status: 429, retryAfter: '7' }]);
  await startPeer();
  await db.command({ collMod: notices.collectionName, validator: {} });

  const browserCalls = (publication, device) => calls.filter(call =>
    call.headers.topic === publication.publicationId && call.path === device.path);
  await eventually('两台设备应有持久投递记录', async () => (await jobs(directPublished.publicationId)).length === 2);
  await eventually('第一台验收及第二台限流后，重试时间应已持久化', async () => {
    const secondRecord = await subscriptions.findOne({ endpoint: secondDevice.body.endpoint });
    return secondRecord?.retryNotBefore && browserCalls(directPublished, firstDevice).length === 1;
  });
  await restartServer();
  await eventually('重启与并行实例下，应恢复读取并处理限流等待', async () =>
    (await jobs(directPublished.publicationId)).filter(job => job.state === 'accepted').length === 2);
  assert.deepEqual(await publish(direct, directInput), directPublished);
  assert.equal(browserCalls(directPublished, firstDevice).length, 1);
  const retries = browserCalls(directPublished, secondDevice);
  assert.equal(retries.length, 2);
  assert.ok(retries[1].at - retries[0].at >= 7000);
  assert.equal(calls.filter(call => call.headers.topic === directPublished.publicationId).length, 3);

  const firstInbox = await employee('/employee/dispatch-notices', first);
  const lateInbox = await employee('/employee/dispatch-notices', late);
  const dispatcherInbox = await employee('/employee/dispatch-notices', dispatcher);
  assert.equal(firstInbox.items[0].orderId, direct.id);
  assert.equal(lateInbox.items[0].orderId, direct.id);
  assert.equal(dispatcherInbox.items[0].orderId, direct.id);
  const firstCall = browserCalls(directPublished, firstDevice)[0];
  for (const [call, device] of [[firstCall, firstDevice], ...retries.map(retry => [retry, secondDevice])]) {
    assert.equal(call.headers['content-encoding'], 'aes128gcm');
    assert.ok(Number(call.headers.ttl) > 0 && Number(call.headers.ttl) <= 900);
    checkVapid(call.headers, vapid.publicKey);
    const { expiresAt, deviceBinding, ...payload } = decrypt(call.body, device);
    assert.ok(expiresAt > Date.now());
    assert.match(deviceBinding, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(payload, {
      type: 'club-dispatch', version: 1, message: '有新派单，点击进入接单区',
      publicationId: directPublished.publicationId, noticeId: firstInbox.items[0].id,
    });
  }
  assert.throws(() => decrypt(firstCall.body, secondDevice));

  await prepare(customerOrder);
  await db.command({ collMod: notices.collectionName, validator: { recipientUserId: dispatcher.id } });
  const secondPublished = await publish(customerOrder, publishInput());
  responses.set(`${secondPublished.publicationId}:${firstDevice.path}`, [{ status: 410 }]);
  responses.set(`${secondPublished.publicationId}:${secondDevice.path}`, [{ status: 503, retryAfter: '10' }]);
  await db.command({ collMod: notices.collectionName, validator: {} });
  await eventually('一个设备失效仍可完成站内通知及其他设备的投递', async () => {
    const saved = await orders.findOne({ _id: id(customerOrder.id) });
    return !saved.publication.pending && browserCalls(secondPublished, lateDevice).length === 1 &&
      browserCalls(secondPublished, secondDevice).length === 1 &&
      !(await subscriptions.findOne({ endpoint: firstDevice.body.endpoint }));
  });
  assert.deepEqual(await employee(pushRoute, first), { publicKey: vapid.publicKey, fingerprint: null });
  const secondBinding = await subscriptions.findOne({ endpoint: secondDevice.body.endpoint });
  const switched = await employeeBrowserLogin('push_outside');
  assert.deepEqual(await employee(pushRoute, switched), { publicKey: vapid.publicKey, fingerprint: null });
  await employee(pushRoute, second, 'GET', undefined, 401);
  const returned = await employeeBrowserLogin('push_member');
  const returnedSession = await db.collection('app_sessions').findOne({ _id: secondBinding.sessionId });
  assert.equal(returnedSession.userId, first.id);
  assert.notEqual(returnedSession.accessHash, secondBinding.accessHash);
  await enable(returned, secondDevice);
  await eventually('A→B→A 的新绑定不能收到旧代次的重试', async () =>
    (await jobs(secondPublished.publicationId)).filter(job => job.state === 'cancelled').length === 2);
  assert.equal(browserCalls(secondPublished, secondDevice).length, 1);
  assert.ok((await employee('/employee/dispatch-notices', late)).items.some(notice => notice.orderId === customerOrder.id));
  assert.deepEqual(await employee('/employee/dispatch-notices', outside), { items: [], nextCursor: null, hasUnread: false });
  assert.ok(!calls.some(call => call.path === otherDevice.path));

  const newStatus = await employee(pushRoute, returned);
  assert.ok(newStatus.fingerprint);
  await employee(pushRoute, returned, 'DELETE', { fingerprint: randomBytes(32).toString('base64url') });
  assert.deepEqual(await employee(pushRoute, returned), newStatus);
  await employee(pushRoute, returned, 'DELETE');
  await employee(pushRoute, returned, 'DELETE');
  assert.equal((await employee(pushRoute, returned)).fingerprint, null);
});

test('三端通知分级、接待和生效罚款使用同一套可靠投递', { timeout: 180_000 }, async t => {
  const { vapid, calls, responses, extraEnv, extraFixtures } = await startGateway(t);
  const { db, base, api, administrator, register, login, seedClub, runCommand, restartServer } = await startClubSystem(t, {
    database: 'app_notifications_e2e', adminUsername: 'notice_admin', extraEnv, extraFixtures,
  });
  const apps = ['admin', 'employee', 'client'];
  const actors = { admin: administrator };
  for (const app of ['employee', 'client']) actors[app] = await login(app, 'notice_admin');
  assert.deepEqual(new Set(Object.values(actors).map(actor => actor.id)), new Set([administrator.id]));
  const member = await register('notice_member', 'employee');
  const approver = await register('notice_approver', 'employee');
  const buyer = await register('notice_buyer', 'client');
  for (const actor of [administrator, member, approver]) await seedClub('member', actor.id, 'active', 'member');
  await seedClub('position', administrator.id, 'leader');
  await seedClub('position', approver.id, 'deputy');

  const devices = Object.fromEntries([...apps, 'member', 'approver'].map(name => [name, syntheticDevice('/' + name, vapid.publicKey)]));
  const request = (app, path, actor = actors[app], method = 'GET', body, status = 200) =>
    api(app, '/' + app + '/' + path, { token: actor?.token, method, body, status });
  const list = (app, actor) => request(app, 'notifications', actor);
  for (const app of apps) {
    assert.equal((await request(app, 'notification-push', actors[app], 'PUT', devices[app].body)).publicKey, vapid.publicKey);
  }
  await request('employee', 'notification-push', member, 'PUT', devices.member.body);
  await request('employee', 'notification-push', approver, 'PUT', devices.approver.body);
  await request('employee', 'notification-push', actors.employee, 'PUT', devices.admin.body, 409);
  await request('admin', 'notifications', actors.employee, 'GET', undefined, 403);
  await request('site', 'notifications', actors.client, 'GET', undefined, 404);
  assert.equal((await fetch(base + '/admin/notifications', {
    headers: { origin: 'https://employee.club.test', authorization: 'Bearer ' + actors.admin.token },
  })).status, 403);

  async function publish(app, type, title) {
    const { stdout } = await runCommand('dist/src/commands/club.js', 'notify', app, type,
      'shared.' + type, administrator.id, title, '本端通知回归');
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  }

  const events = {};
  for (const app of apps) {
    events[app] = {};
    for (const type of ['normal', 'important', 'system']) events[app][type] = await publish(app, type, app + ' ' + type);
    assert.deepEqual(await publish(app, 'important', app + ' important'), events[app].important);
  }
  await assert.rejects(() => publish('admin', 'important', '同一事件不得覆写'), /相同通知事件/);

  const jobs = db.collection('club_dispatch_push_deliveries');
  const notices = db.collection('club_dispatch_notices');
  const eventRecords = db.collection('app_notification_events');
  const objectId = value => new Types.ObjectId(value);
  const payloadFor = (eventId, device) => calls.filter(call => call.headers.topic === String(eventId) && call.path === device.path)
    .map(call => decrypt(call.body, device));
  await eventually('三端分别只收到本端重要及系统通知', () => calls.length === 6);
  for (const app of apps) {
    const device = devices[app];
    const { items, hasUnread } = await list(app);
    assert.equal(hasUnread, true);
    assert.deepEqual(items.map(item => item.title).sort(), [app + ' important', app + ' normal']);
    const normal = items.find(item => item.type === 'normal');
    const important = items.find(item => item.type === 'important');
    assert.equal(await jobs.countDocuments({ publicationId: objectId(events[app].normal.id) }), 0);
    const system = await notices.findOne({ publicationId: objectId(events[app].system.id) });
    assert.deepEqual(payloadFor(events[app].important.id, device).map(payload =>
      [payload.noticeType, payload.targetApp, payload.noticeId]), [['important', app, important.id]]);
    const [systemPayload] = payloadFor(events[app].system.id, device);
    assert.deepEqual([systemPayload.noticeType, systemPayload.targetApp, systemPayload.noticeId], ['system', app, system._id.toHexString()]);
    await request(app, 'notifications/' + system._id, actors[app], 'GET', undefined, 404);
    await request(app, 'notifications/' + system._id + '/read', actors[app], 'PATCH', undefined, 404);
    const read = await request(app, 'notifications/' + normal.id + '/read', actors[app], 'PATCH');
    assert.deepEqual(await request(app, 'notifications/' + normal.id + '/read', actors[app], 'PATCH'), read);
    await request(app, 'notifications/' + normal.id, actors[app], 'GET', undefined, 404);
    await request(app, 'notifications/' + important.id + '/read', actors[app], 'PATCH');
    assert.deepEqual((await list(app)).items.map(item => item.id), [important.id]);
    assert.equal((await list(app)).hasUnread, false);
  }
  assert.deepEqual((await list('employee', member)).items, []);

  const place = (fields = {}) => request('client', 'orders', buyer, 'POST', {
    requestId: randomUUID(), requestedGiftTimes: 20, recipientGameAccount: '不应写进设备通知', ...fields,
  }, 201);
  const waiting = await place();
  assert.equal(waiting.dispatchStatus, 'pending_assignment');
  const intakeKey = order => 'club.order.assigned:' + order.id;
  assert.equal(await eventRecords.countDocuments({ eventKey: intakeKey(waiting) }), 0);
  await request('employee', 'club/orders/' + waiting.id + '/assign-dispatcher', actors.employee, 'POST',
    { requestId: randomUUID(), dispatcherUserId: member.id }, 201);
  await seedClub('member', member.id, 'active', 'dispatcher');
  const selected = await place({ dispatcherUserId: member.id });
  assert.equal(selected.dispatchStatus, 'pending');
  for (const order of [waiting, selected]) {
    const key = intakeKey(order);
    const event = await eventually('本单接待事件已投递', async () => {
      const event = await eventRecords.findOne({ eventKey: key });
      return event && payloadFor(event._id, devices.member).length === 1 && event;
    });
    const [payload] = payloadFor(event._id, devices.member);
    const path = 'notifications/' + payload.noticeId;
    const item = await request('employee', path, member);
    assert.deepEqual([item.orderId, item.type, item.target], [order.id, 'important', 'client-order-assigned']);
    assert.deepEqual(event.recipientUserIds, [member.id]);
    assert.ok(!JSON.stringify(payload).includes('不应写进设备通知'));
    await request('employee', path, actors.employee, 'GET', undefined, 404);
  }

  const adjustments = db.collection('club_financial_adjustments');
  const decidedAt = new Date();
  const terms = {
    clubId: 'club', status: 'approved', revision: 2, kind: 'member_penalty', amountCents: 200,
    reason: '通知仅提示状态', requestedByUserId: administrator.id, memberUserId: member.id,
    decidedByUserId: approver.id, createdAt: new Date(decidedAt - 1000), decidedAt,
  };
  // Current grants must not invalidate a historical decision. A long page of
  // malformed legacy approvals must not conceal the valid approvals after it.
  const commonRole = await db.collection('roles').findOne({ role_code: 'common' });
  await db.collection('users').updateOne({ _id: approver.id }, { $set: { role_ids: [commonRole._id] } });
  const { decidedByUserId: _missingDecisionMaker, ...withoutDecisionMaker } = terms;
  const invalidRefund = {
    requestId: randomUUID(), amountCents: 200, occurredAt: decidedAt, recordedAt: decidedAt, recordedByUserId: administrator.id,
  };
  const malformed = await adjustments.insertMany([
    ...Array.from({ length: 55 }, () => ({ ...withoutDecisionMaker })),
    { ...terms, decidedByUserId: 'invalid' },
    { ...terms, decidedAt: null },
    { ...terms, decidedAt: decidedAt.toISOString() },
    { ...terms, amountCents: 0 },
    { ...terms, amountCents: 1.5 },
    { ...terms, memberUserId: null },
    { ...terms, requestedByUserId: null },
    { ...terms, refunds: [invalidRefund] },
    { ...terms, clubId: 'other' },
  ]);
  responses.set(devices.member.path, [{ status: 503, retryAfter: '12' }]);
  const { insertedIds } = await adjustments.insertMany([
    terms,
    { ...terms, memberUserId: administrator.id, decidedByUserId: administrator.id, revision: 1 },
    { ...terms, status: 'pending' },
    { ...terms, status: 'rejected' },
    { ...terms, kind: 'customer_compensation' },
  ]);
  const findPenalty = id => eventRecords.findOne({ eventKey: 'club.penalty.approved:' + id });
  const [two, one] = await eventually('罚款按两种角色生成重要通知', async () => {
    const events = await Promise.all([findPenalty(insertedIds[0]), findPenalty(insertedIds[1])]);
    return events.every(Boolean) && events;
  });
  await eventually('重启前须确认罚款设备的重试调度已保存', async () => {
    const pending = await jobs.findOne({ publicationId: two._id, userId: member.id, state: 'pending', lease: { $exists: false } });
    const firstAttempt = calls.find(call => call.headers.topic === String(two._id) && call.path === devices.member.path);
    return pending && firstAttempt && pending.nextAttemptAt.getTime() >= firstAttempt.at + 12000 &&
      await jobs.countDocuments({ publicationId: two._id, state: 'accepted' }) === 1 &&
      await jobs.countDocuments({ publicationId: one._id, state: 'accepted' }) === 1;
  });
  await adjustments.updateMany({ _id: { $in: [insertedIds[0], insertedIds[1]] } }, { $unset: { notificationPublishedAt: '' } });
  await restartServer();
  await eventually('罚款后台恢复确认且设备失败完成重试', async () =>
    await adjustments.countDocuments({ notificationPublishedAt: { $type: 'date' } }) === 2 &&
    await jobs.countDocuments({ publicationId: two._id, state: 'accepted' }) === 2 &&
    await jobs.countDocuments({ publicationId: one._id, state: 'accepted' }) === 1);
  assert.equal((await adjustments.findOne({ _id: insertedIds[0] })).revision, 2);
  assert.deepEqual(two.recipientUserIds, [administrator.id, member.id].sort());
  assert.deepEqual(one.recipientUserIds, [administrator.id]);
  assert.deepEqual(await Promise.all([2, 3, 4].map(index => findPenalty(insertedIds[index]))), [null, null, null]);
  const malformedIds = Object.values(malformed.insertedIds);
  assert.equal(await eventRecords.countDocuments({
    eventKey: { $in: malformedIds.map(id => 'club.penalty.approved:' + id) },
  }), 0);
  const checkedIds = [malformedIds[0], ...malformedIds.slice(55), insertedIds[2], insertedIds[3], insertedIds[4], insertedIds[0]];
  const { stdout } = await runCommand('-e', `
    require('module-alias/register');
    const { Module } = require('@nestjs/common');
    const { NestFactory } = require('@nestjs/core');
    const { MongooseModule } = require('@nestjs/mongoose');
    const { ClubModule } = require('./dist/src/modules/club');
    const { AppNotificationService } = require('./dist/src/modules/club/app-notification.service');
    const mongo = require('./dist/src/app.config').default.DataBase.Mongo;
    class ProducerTestModule {}
    Module({ imports: [
      MongooseModule.forRoot(mongo.CONNECTION, mongo.USERNAME ? { user: mongo.USERNAME, pass: mongo.PASSWORD } : {}),
      ClubModule,
    ] })(ProducerTestModule);
    (async () => {
      const app = await NestFactory.createApplicationContext(ProducerTestModule, { logger: false, abortOnError: false });
      try {
        const service = app.get(AppNotificationService);
        const results = await Promise.all(JSON.parse(process.argv[1]).map(id => service.publishApprovedPenalty(id)));
        console.log(JSON.stringify(results.map(result => result?.id ?? null)));
      } finally { await app.close(); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `, JSON.stringify(checkedIds));
  assert.deepEqual(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)), [
    ...Array(checkedIds.length - 1).fill(null), two._id.toHexString(),
  ]);
  assert.equal(await notices.countDocuments({ publicationId: two._id }), 2);
  assert.equal(await notices.countDocuments({ publicationId: one._id }), 1);
  assert.equal(payloadFor(two._id, devices.member).length, 2);
  assert.deepEqual(payloadFor(two._id, devices.member)[0], payloadFor(two._id, devices.member)[1]);
  for (const name of ['admin', 'client', 'approver']) {
    assert.equal(payloadFor(two._id, devices[name]).length, 0);
    assert.equal(payloadFor(one._id, devices[name]).length, 0);
  }
  await request('employee', 'notifications', approver, 'GET', undefined, 401);

  const repaired = malformedIds[0];
  await adjustments.updateOne({ _id: repaired }, { $set: { decidedByUserId: approver.id } });
  await eventually('恢复有效的历史记录会在下一轮补投', () => findPenalty(repaired));
});
