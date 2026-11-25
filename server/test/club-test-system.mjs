import assert from 'node:assert/strict';
import { captchaCode, startSystem } from './start-system.mjs';

const origin = (app) => `https://${app}.club.test`;

export async function startClubSystem(t, { database, adminUsername, extraFixtures, extraEnv, concurrentStarts }) {
  const { db, base, password, seedClub, runCommand, restartServer, startPeer } = await startSystem(t, {
    database,
    adminUsername,
    extraFixtures,
    extraEnv,
    concurrentStarts,
    origins: Object.fromEntries(['admin', 'employee', 'client', 'site'].map((app) => [app, origin(app)])),
  });
  const challenges = new Map();
  const api = async (app, path, { method = 'GET', body, token, status = 200, message, server = base } = {}) => {
    const headers = { origin: origin(app) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (path.startsWith('/user/') && challenges.has(app)) {
      headers.cookie = challenges.get(app);
      challenges.delete(app);
    }
    const response = await fetch(server + path, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    const failure = `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`;
    if (Array.isArray(status)) assert.ok(status.includes(response.status), failure);
    else assert.equal(response.status, status, failure);
    if (message) assert.match(payload.message, message, failure);
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
  const administrator = await login('admin', adminUsername);
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
  return { db, base, password, api, seedClub, runCommand, login, administrator, register, restartServer, startPeer };
}
