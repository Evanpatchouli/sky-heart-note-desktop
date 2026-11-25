import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const exec = promisify(execFile);
const secret = () => randomBytes(24).toString('hex');
export const captchaCode = 'C7k9';

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startChild(cleanup, executable, args, options) {
  const child = spawn(executable, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-6000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const closed = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  };
  cleanup.push(stop);
  await once(child, 'spawn');
  const check = () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`子进程已退出\n${output}`);
  };
  return { check, stop };
}

export async function startSystem(t, { database, origins, adminUsername, extraFixtures = '', initialCache = {}, extraEnv = {}, concurrentStarts = false }) {
  const directory = await mkdtemp(join(tmpdir(), 'sky-heart-e2e-'));
  const cleanup = [];
  t.after(async () => {
    for (const stop of cleanup.reverse()) await stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const mongoDir = join(directory, 'mongo');
  const appDir = join(directory, 'server');
  await Promise.all([mkdir(mongoDir), mkdir(appDir)]);
  const mongoPort = await freePort();
  await startChild(cleanup, process.env.MONGOD_BINARY || 'mongod', [
    '--dbpath', mongoDir, '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--logpath', join(directory, 'mongo.log'),
  ]);
  const uri = `mongodb://127.0.0.1:${mongoPort}/${database}`;
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  cleanup.push(() => client.close());
  await client.connect();
  const db = client.db();
  const members = db.collection('club_members');
  const seedClub = async (fixture, userId, value, mark) => {
    if (fixture === 'name') {
      await db.collection('clubs').updateOne({ _id: 'club' }, { $set: { name: userId } });
      return;
    }
    const key = { clubId: 'club', userId };
    if (fixture === 'member') {
      const active = value === 'active';
      await members.updateOne(key, {
        $set: { active, dispatcher: active && mark === 'dispatcher', ...(active ? {} : { permissions: [], position: 'member' }) },
        $setOnInsert: { ...key, ...(active ? { permissions: [], position: 'member' } : {}) },
      }, { upsert: true });
      return;
    }
    const updates = {
      grant: { $addToSet: { permissions: value } },
      revoke: { $pull: { permissions: value } },
      position: { $set: { position: value } },
    };
    assert.ok(updates[fixture]);
    const result = await members.updateOne({ ...key, active: true }, updates[fixture]);
    assert.equal(result.matchedCount, 1);
  };
  const dbPassword = secret();
  await db.command({ createUser: 'test_server', pwd: dbPassword, roles: [{ role: 'readWrite', db: database }] });

  await Promise.all([
    cp(join(serverRoot, 'dist'), join(appDir, 'dist'), { recursive: true }),
    copyFile(join(serverRoot, 'package.json'), join(appDir, 'package.json')),
    symlink(join(serverRoot, 'node_modules'), join(appDir, 'node_modules'), 'junction'),
    writeFile(join(appDir, 'fixtures.cjs'), `
      require('svg-captcha').create = () => ({ text: '${captchaCode}', data: '<svg>${captchaCode}</svg>' });
      ${extraFixtures}
    `),
    writeFile(join(appDir, 'cache.json'), JSON.stringify(initialCache)),
  ]);
  const { scripts } = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  const [command, ...entry] = scripts['start:prod'].split(/\s+/);
  assert.equal(command, 'node');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api`;
  const password = secret();
  const options = {
    cwd: appDir,
    env: {
      ...process.env, NODE_ENV: 'production', APP_ENV: 'production', APP_HOST: '127.0.0.1', APP_PORT: String(port),
      MONGODB_URI: uri, DB_MONGO_CONNECTION: uri, DB_MONGO_USERNAME: 'test_server', DB_MONGO_PASSWORD: dbPassword,
      APP_SECRET: secret(), JWT_SECRET: secret(), SESSION_SECRET: secret(), MIGRATE_ON_START: 'true',
      EMPLOYEE_DATA_DIR: join(directory, 'employee'), ADMIN_ORIGIN: origins.admin, EMPLOYEE_ORIGIN: origins.employee,
      CLIENT_ORIGIN: origins.client, SITE_ORIGIN: origins.site, LOG_LEVEL: 'error',
      BOOTSTRAP_ADMIN_USERNAME: adminUsername, BOOTSTRAP_ADMIN_PASSWORD: password,
      WEB_PUSH_VAPID_PUBLIC_KEY: '', WEB_PUSH_VAPID_PRIVATE_KEY: '', WEB_PUSH_VAPID_SUBJECT: '',
      WEB_PUSH_ALLOWED_ORIGINS: '',
      ...extraEnv,
    },
    windowsHide: true,
  };
  const launch = async (appPort, overrides = {}) => {
    const running = await startChild(cleanup, process.execPath, ['--require', './fixtures.cjs', ...entry], {
      ...options,
      env: { ...options.env, APP_PORT: String(appPort), ...overrides },
    });
    const appBase = `http://127.0.0.1:${appPort}/api`;
    for (let i = 0; i < 180; i++) {
      running.check();
      const response = await fetch(appBase + '/captcha/login?app=client', { headers: { origin: origins.client } }).catch(() => null);
      if (response?.ok) return { ...running, base: appBase };
      await sleep(250);
    }
    throw new Error('等待服务启动超时');
  };
  const peerPort = concurrentStarts ? await freePort() : undefined;
  let [running] = await Promise.all([launch(port), ...(peerPort ? [launch(peerPort)] : [])]);
  return {
    db, base, password, seedClub,
    runCommand: (...args) => exec(process.execPath, args, options),
    restartServer: async (overrides) => {
      await running.stop();
      running = await launch(port, overrides);
    },
    startPeer: async (overrides) => (await launch(await freePort(), overrides)).base,
  };
}
