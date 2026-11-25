import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import { captchaCode, startSystem } from './start-system.mjs';

const apps = ['admin', 'employee', 'client'];
const origins = Object.fromEntries([...apps, 'site'].map(app => [app, `https://${app}.sky.test`]));
const otpEmail = 'short.id@example.test';
const otpCode = '123456';

// Each instance represents one browser's API-host cookies.
function browser(base) {
  const cookies = new Map();
  async function request(app, path, { method = 'GET', body, token, status, cacheControl, origin = origins[app] } = {}) {
    const headers = { origin };
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    if (path.startsWith('/user/') && cookies.size) {
      headers.cookie = [...cookies].map(([k, v]) => k + '=' + v).join('; ');
    }
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    if (cacheControl) assert.equal(res.headers.get('cache-control'), cacheControl);
    for (const cookie of res.headers.getSetCookie()) {
      assert.match(cookie, /; HttpOnly/i);
      assert.match(cookie, /; Secure/i);
      assert.match(cookie, /; Path=\/api\/user/i);
      const pair = cookie.split(';')[0];
      const i = pair.indexOf('=');
      if (pair.length > i + 1) cookies.set(pair.slice(0, i), pair.slice(i + 1));
      else cookies.delete(pair.slice(0, i));
    }
    const payload = await res.json();
    const message = `${method} ${path} → ${res.status} ${payload.message}`;
    if (status !== undefined) assert.equal(res.status, status, message);
    else {
      assert.ok(res.ok, message);
      assert.equal(payload.code, 'SUCCESS', message);
    }
    return payload.data;
  }
  return {
    request,
    async login(app, username, password, status) {
      await request(app, '/captcha/login?app=' + app);
      return request(app, '/user/login?type=account', {
        method: 'POST', body: { app, username, password, captcha: captchaCode }, status,
      });
    },
    candidates: app => request(app, '/user/login/candidates?app=' + app),
    borrow: (app, sourceApp, sourceUserId, status) => request(app, '/user/login?type=shared', {
      method: 'POST', body: { app, sourceApp, sourceUserId }, status,
    }),
  };
}

test('生产入口、Mongo 角色与三端授权', { timeout: 120000 }, async t => {
  const { db, base, password } = await startSystem(t, {
    database: 'webapps_e2e',
    origins,
    adminUsername: 'test_admin',
    // Repeated samples exercise the real database's unique primary key.
    extraFixtures: `
      const crypto = require('node:crypto');
      const randomInt = crypto.randomInt;
      const userIds = ['00A0', '00A0', 'COM1', 'COM1', '0002', '0002', '00A3'];
      crypto.randomInt = (...args) => args.length === 1 && args[0] === 36 ** 4 && userIds.length
        ? parseInt(userIds.shift(), 36)
        : randomInt(...args);
    `,
    initialCache: {
      items: {
        ['opt::login::email::' + otpEmail]: {
          value: otpCode, createAt: Date.now(), expireAt: Date.now() + 120000,
        },
      },
    },
  });
  const roles = await db.collection('roles').find({ role_code: { $in: ['admin', 'employee', 'common'] } }).toArray();
  assert.equal(roles.length, 3, '启动迁移应提供三个内置角色');
  assert.equal(roles.find(role => role.role_code === 'employee')?.role_name, '团员');
  const manager = browser(base);
  const bootstrap = await manager.login('admin', 'test_admin', password);
  const userIds = { admin: bootstrap.id };
  for (const roleCode of ['employee', 'common']) {
    const member = browser(base);
    await member.request('client', '/captcha/register?app=client');
    const user = await member.request('client', '/user/register?type=account', {
      method: 'POST', body: { app: 'client', username: 'test_' + roleCode, password, captcha: captchaCode },
    });
    userIds[roleCode] = user.id;
    if (roleCode === 'employee') {
      await manager.request('admin', '/admin/user-manage/' + user.id + '/roles', {
        method: 'PUT', token: bootstrap.token, body: { roleIds: [String(roles.find(role => role.role_code === 'employee')._id)] },
      });
    }
  }

  await t.test('四位主键保留前导零，建号冲突重试，登录会话和日志引用短 ID', async () => {
    assert.deepEqual(userIds, { admin: '00A0', employee: 'COM1', common: '0002' });
    const contact = await browser(base).request('client', '/user/login?type=email', {
      method: 'POST', body: { app: 'client', email: otpEmail, code: otpCode },
    });
    assert.equal(contact.id, '00A3');

    const users = await db.collection('users').find().toArray();
    assert.equal(users.length, 4);
    for (const user of users) assert.match(user._id, /^[0-9A-Z]{4}$/);
    assert.equal(users.find(user => user._id === '00A3').email, otpEmail);
    assert.equal(users.find(user => user._id === userIds.admin).is_bootstrap_admin, true);

    const accessHash = createHash('sha256').update(contact.token).digest('hex');
    const session = await db.collection('app_sessions').findOne({ accessHash });
    assert.equal(session.userId, contact.id);
    assert.ok(session._id instanceof mongoose.Types.ObjectId);
    const logs = db.collection('loginlogs');
    let log;
    for (let i = 0; i < 20 && !log; i++) {
      log = await logs.findOne({ user_id: contact.id });
      if (!log) await sleep(50);
    }
    assert.equal(log?.user_id, contact.id);
    assert.ok(log._id instanceof mongoose.Types.ObjectId);
  });

  await t.test('同昵称用户按短 ID 查询和借用，保留各自身份', async () => {
    const nickname = '同名团员';
    const userIdsWithSameName = [userIds.admin, userIds.employee];
    await db.collection('users').updateMany({ _id: { $in: userIdsWithSameName } }, { $set: { nickname } });
    const auth = { token: bootstrap.token };
    const page = '/admin/user-manage?page=1&size=10';
    const everyone = await manager.request('admin', page, auth);
    assert.deepEqual(everyone.list.filter(user => user.nickname === nickname).map(user => user.id).sort(), userIdsWithSameName);
    for (const id of userIdsWithSameName) {
      const found = await manager.request('admin', page + '&id=' + id, auth);
      assert.equal(found.total, 1);
      assert.deepEqual(found.list.map(user => [user.nickname, user.id]), [[nickname, id]]);
      assert.equal((await manager.request('admin', '/admin/user-manage/' + id, auth)).id, id);
    }
    assert.equal((await manager.request('admin', page + '&id=ABCD', auth)).total, 0);
    await manager.request('admin', page + '&id=00002', { ...auth, status: 400 });

    const b = browser(base);
    await b.login('admin', 'test_admin', password);
    await b.login('employee', 'test_employee', password);
    const candidates = await b.candidates('client');
    assert.deepEqual(candidates.map(({ sourceApp, nickname, id }) => [sourceApp, nickname, id]), [
      ['admin', nickname, userIds.admin],
      ['employee', nickname, userIds.employee],
    ]);
    await b.borrow('client', 'employee', userIds.admin, 401);
    assert.equal((await b.borrow('client', 'employee', userIds.employee)).id, userIds.employee);
    assert.equal((await b.borrow('client', 'admin', userIds.admin)).id, userIds.admin);
  });

  await t.test('官网匿名可读，团员工作区、设置和共享变量需要团员端授权', async () => {
    const response = await fetch(base + '/site', { headers: { origin: 'https://site.sky.test' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, '送心手记');
    const employee = browser(base);
    const { token } = await employee.login('employee', 'test_employee', password);
    await employee.request('employee', '/employee/workspace', { status: 401 });
    const workspace = await employee.request('employee', '/employee/workspace', { token });
    assert.equal(workspace.appDir, '/api/employee/');
    const setting = '/employee/settings/theme';
    await employee.request('employee', setting, { method: 'PUT', token, body: { value: 'dark' } });
    assert.equal((await employee.request('employee', '/employee/settings', { token }))[0].value, 'dark');
    assert.equal(await employee.request('employee', setting, { method: 'DELETE', token }), true);
    const share = '/employee/share';
    await employee.request('employee', share, { method: 'POST', token, body: { key: 'tab', value: '"today"' } });
    assert.deepEqual(await employee.request('employee', share, { token }), { tab: '"today"' });
    await employee.request('employee', share + '?key=tab', { method: 'DELETE', token });
    assert.deepEqual(await employee.request('employee', share, { token }), {});
  });

  await t.test('九种登录组合遵守角色矩阵，站点不能作为登录来源', async () => {
    const access = { admin: apps, employee: ['employee', 'client'], common: ['client'] };
    for (const [role, allowed] of Object.entries(access)) {
      for (const app of apps) {
        const result = await browser(base).login(app, 'test_' + role, password, allowed.includes(app) ? undefined : 403);
        if (allowed.includes(app)) assert.equal(result.app, app);
      }
    }
    await browser(base).request('client', '/user/login?type=account', {
      method: 'POST', body: { app: 'site', username: 'test_admin', password, captcha: captchaCode }, status: 400,
    });
  });

  await t.test('跨端须显式授权；来源退出后不能再借用，目标会话仍可使用', async () => {
    const b = browser(base);
    const admin = await b.login('admin', 'test_admin', password);
    const candidates = await b.candidates('client');
    assert.deepEqual(candidates.map(({ id, sourceApp }) => [id, sourceApp]), [[admin.id, 'admin']]);
    assert.equal(candidates[0].token, undefined);
    await b.request('client', '/user/session?app=client', { status: 401 });
    await b.request('client', '/user/login/candidates?app=admin', { status: 403 });
    await b.borrow('client', 'admin', userIds.common, 401);
    const client = await b.borrow('client', 'admin', admin.id);
    assert.equal(client.id, admin.id);
    assert.notEqual(client.token, admin.token);
    await b.request('client', '/admin/user-manage?page=1&size=10', { token: client.token, status: 403 });
    await b.request('admin', '/user/logout', { method: 'POST', token: admin.token });
    await b.request('admin', '/user/session?app=admin', { token: admin.token, status: 401 });
    await b.borrow('employee', 'admin', admin.id, 401);
    assert.equal((await b.request('client', '/user/session?app=client', { token: client.token })).id, admin.id);
    const employee = await b.borrow('employee', 'client', client.id);
    assert.equal(employee.id, admin.id);
    const adminAgain = await b.borrow('admin', 'employee', employee.id);
    assert.equal(adminAgain.id, admin.id);
    assert.notEqual(adminAgain.token, admin.token);
    assert.deepEqual(await browser(base).candidates('employee'), []);
  });

  await t.test('过期授权不能访问业务或作为借用来源', async () => {
    const b = browser(base);
    const session = await b.login('employee', 'test_admin', password);
    assert.equal((await b.candidates('client'))[0].id, session.id);
    const accessHash = createHash('sha256').update(session.token).digest('hex');
    const changed = await db.collection('app_sessions').updateOne({ accessHash }, { $set: { expiresAt: new Date(0) } });
    assert.equal(changed.modifiedCount, 1);
    await b.request('employee', '/employee/bookings', { token: session.token, status: 401 });
    assert.deepEqual(await b.candidates('client'), []);
    await b.borrow('client', 'employee', session.id, 401);
  });

  await t.test('团员数据读写、账号隔离、撤权后现有授权立即失效', async () => {
    const a = browser(base), b = browser(base);
    const worker = await a.login('employee', 'test_employee', password);
    const admin = await b.login('admin', 'test_admin', password);
    const other = await b.borrow('employee', 'admin', admin.id);
    const bookings = '/employee/bookings';
    await a.request('employee', bookings, { status: 401 });
    await b.request('admin', bookings, { token: admin.token, status: 403 });
    const id = await a.request('employee', bookings, { method: 'POST', token: worker.token, body: { title: '订单' } });
    assert.equal(await a.request('employee', bookings + '/' + id, { method: 'PATCH', token: worker.token, body: { remark: '备注' } }), true);
    assert.equal((await a.request('employee', bookings, { token: worker.token, cacheControl: 'no-store' }))[0].remark, '备注');
    assert.deepEqual(await b.request('employee', bookings, { token: other.token, cacheControl: 'no-store' }), []);
    assert.equal(await b.request('employee', bookings + '/' + id, { method: 'DELETE', token: other.token }), false);
    assert.equal(await a.request('employee', bookings + '/' + id, { method: 'DELETE', token: worker.token }), true);
    const commonRole = roles.find(role => role.role_code === 'common');
    await b.request('admin', '/admin/user-manage/' + worker.id + '/roles', {
      method: 'PUT', token: admin.token, body: { roleIds: [String(commonRole._id)] },
    });
    await a.request('employee', bookings, { token: worker.token, status: 401 });
    assert.deepEqual(await a.candidates('client'), []);
    await a.borrow('client', 'employee', worker.id, 401);
    const common = browser(base);
    const user = await common.login('client', 'test_common', password);
    assert.deepEqual(await common.candidates('admin'), []);
    await common.borrow('employee', 'client', user.id, 401);
  });
});
