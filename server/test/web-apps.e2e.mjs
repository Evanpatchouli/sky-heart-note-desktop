import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apps = ['admin', 'employee', 'client'];
const origins = Object.fromEntries(apps.map(app => [app, `https://${app}.sky.test`]));
const secret = () => randomBytes(24).toString('hex');

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startChild(executable, args, options) {
  const child = spawn(executable, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = chunk => { output = (output + chunk.toString()).slice(-6000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  await once(child, 'spawn');
  return {
    check() {
      if (child.exitCode !== null || child.signalCode) throw new Error(`子进程已退出\n${output}`);
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      const closed = once(child, 'close');
      child.kill();
      await closed;
    },
  };
}

async function startSystem(directory, cleanup) {
  const mongoDir = join(directory, 'mongo');
  await mkdir(mongoDir);
  const mongoPort = await freePort();
  const mongo = await startChild(process.env.MONGOD_BINARY || 'mongod', [
    '--dbpath', mongoDir, '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--logpath', join(directory, 'mongo.log'),
  ]);
  cleanup.push(() => mongo.stop());
  const uri = `mongodb://127.0.0.1:${mongoPort}/webapps_e2e`;
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  cleanup.push(() => client.close());
  await client.connect();
  const db = client.db();
  const password = secret();
  await db.command({ createUser: 'test_server', pwd: password, roles: [{ role: 'readWrite', db: db.databaseName }] });

  const appDir = join(directory, 'server');
  await mkdir(appDir);
  await Promise.all([
    cp(join(serverRoot, 'dist'), join(appDir, 'dist'), { recursive: true }),
    copyFile(join(serverRoot, 'package.json'), join(appDir, 'package.json')),
    symlink(join(serverRoot, 'node_modules'), join(appDir, 'node_modules'), 'junction'),
    // Give the isolated test process a deterministic image challenge; its HTTP
    // session, CAPTCHA middleware and credential validation still run normally.
    writeFile(join(appDir, 'captcha.cjs'), `require('svg-captcha').create = () => ({ text: 'C7k9', data: '<svg>C7k9</svg>' });`),
  ]);
  const { scripts } = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  const [command, ...entry] = scripts['start:prod'].split(/\s+/);
  assert.equal(command, 'node');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api`;
  const adminPassword = secret();
  const server = await startChild(process.execPath, ['--require', './captcha.cjs', ...entry], {
    cwd: appDir,
    env: {
      ...process.env, NODE_ENV: 'production', APP_ENV: 'production', APP_HOST: '127.0.0.1', APP_PORT: String(port),
      MONGODB_URI: uri, DB_MONGO_CONNECTION: uri, DB_MONGO_USERNAME: 'test_server', DB_MONGO_PASSWORD: password,
      APP_SECRET: secret(), JWT_SECRET: secret(), SESSION_SECRET: secret(), MIGRATE_ON_START: 'true',
      EMPLOYEE_DATA_DIR: join(directory, 'employee'), ADMIN_ORIGIN: origins.admin, EMPLOYEE_ORIGIN: origins.employee,
      CLIENT_ORIGIN: origins.client, SITE_ORIGIN: 'https://site.sky.test', LOG_LEVEL: 'error',
      BOOTSTRAP_ADMIN_USERNAME: 'test_admin', BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    },
  });
  cleanup.push(() => server.stop());
  for (let i = 0; i < 180; i++) {
    server.check();
    const response = await fetch(base + '/captcha/login?app=client', { headers: { origin: origins.client } }).catch(() => null);
    if (response?.ok) return { db, base, password: adminPassword };
    await sleep(250);
  }
  throw new Error('等待服务启动超时');
}

// Each instance represents one browser's API-host cookies.
function browser(base) {
  const cookies = new Map();
  async function request(app, path, { method = 'GET', body, token, status, origin = origins[app] } = {}) {
    const headers = { origin };
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    if (path.startsWith('/user/') && cookies.size) {
      headers.cookie = [...cookies].map(([k, v]) => k + '=' + v).join('; ');
    }
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
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
        method: 'POST', body: { app, username, password, captcha: 'C7k9' }, status,
      });
    },
    candidates: app => request(app, '/user/login/candidates?app=' + app),
    borrow: (app, sourceApp, sourceUserId, status) => request(app, '/user/login?type=shared', {
      method: 'POST', body: { app, sourceApp, sourceUserId }, status,
    }),
  };
}

test('生产入口、Mongo 角色与三端授权', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sky-heart-e2e-'));
  const cleanup = [];
  t.after(async () => {
    for (const stop of cleanup.reverse()) await stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const { db, base, password } = await startSystem(directory, cleanup);
  const roles = await db.collection('roles').find({ role_code: { $in: ['admin', 'employee', 'common'] } }).toArray();
  assert.equal(roles.length, 3, '启动迁移应提供三个内置角色');
  assert.equal(roles.find(role => role.role_code === 'employee')?.role_name, '团员');
  const manager = browser(base);
  const bootstrap = await manager.login('admin', 'test_admin', password);
  for (const roleCode of ['employee', 'common']) {
    const member = browser(base);
    await member.request('client', '/captcha/register?app=client');
    const user = await member.request('client', '/user/register?type=account', {
      method: 'POST', body: { app: 'client', username: 'test_' + roleCode, password, captcha: 'C7k9' },
    });
    if (roleCode === 'employee') {
      await manager.request('admin', '/admin/user-manage/' + user.id + '/roles', {
        method: 'PUT', token: bootstrap.token, body: { roleIds: [String(roles.find(role => role.role_code === 'employee')._id)] },
      });
    }
  }

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
      method: 'POST', body: { app: 'site', username: 'test_admin', password, captcha: 'C7k9' }, status: 400,
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
    await b.borrow('client', 'admin', '111111111111111111111111', 401);
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
    assert.equal((await a.request('employee', bookings, { token: worker.token }))[0].remark, '备注');
    assert.deepEqual(await b.request('employee', bookings, { token: other.token }), []);
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
