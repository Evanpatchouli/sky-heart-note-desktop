import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import {
  createConnection,
  mongo,
  type Connection,
  type Model,
  Types,
} from 'mongoose';
import {
  ClubOrder,
  ClubOrderSchema,
} from '../src/modules/club/club-order.schema';
import {
  fieldChanges,
  readLegacySnapshot,
  reviewLegacySnapshot,
  sourceKey,
} from './audit-legacy-club-orders';

// 这组输入由演练预先核实，只用于验证 P1-02 草稿模型。
const verifiedSample = {
  ownerUserId: '00A1',
  localId: '8',
  clubId: 'migration-rehearsal',
  requestId: 'a9fc2895-ff11-494a-9be7-5b3e5847b2ca',
  dispatcherUserId: 'DSP1',
  customerLabel: '演练老板甲',
  recipientGameAccount: '演练收心号甲',
  requestedHearts: 50,
};

type Review = ReturnType<typeof reviewLegacySnapshot>;
type Origin = {
  _id: string;
  booking: Review['rows']['booking'][number];
  sendingAccount: Review['rows']['songxinhao'][number];
  orderId: Types.ObjectId;
};

async function withTemporaryMongo(
  directory: string,
  run: (connection: Connection) => Promise<void>,
) {
  const mongoDir = join(directory, 'mongo');
  const replicaSet = 'legacy-migration-rehearsal';
  mkdirSync(mongoDir);
  // The child binds an OS-assigned port. No database address is read from the environment.
  const child = spawn(
    process.env.MONGOD_BINARY || 'mongod',
    [
      '--dbpath',
      mongoDir,
      '--port',
      '0',
      '--bind_ip',
      '127.0.0.1',
      '--replSet',
      replicaSet,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let recentLog = '';
  const capture = (line: string) => {
    recentLog = (recentLog + line + '\n').slice(-5000);
  };
  child.stderr.setEncoding('utf8').on('data', capture);
  const lines = createInterface({ input: child.stdout });
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  let startupTimeout: NodeJS.Timeout | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      startupTimeout = setTimeout(
        () => reject(new Error(`等待临时 MongoDB 超时\n${recentLog}`)),
        15000,
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(new Error(`临时 MongoDB 已退出 (${code})\n${recentLog}`)),
      );
      lines.on('line', (line) => {
        capture(line);
        if (!line.includes('Waiting for connections')) return;
        const port = JSON.parse(line).attr?.port;
        if (Number.isInteger(port) && port > 0 && port <= 65535) resolve(port);
      });
    }).finally(() => clearTimeout(startupTimeout));

    const host = `127.0.0.1:${port}`;
    const bootstrap = new mongo.MongoClient(`mongodb://${host}/`, {
      directConnection: true,
      serverSelectionTimeoutMS: 10000,
    });
    try {
      await bootstrap.db('admin').command({
        replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host }] },
      });
    } finally {
      await bootstrap.close();
    }

    const connection = createConnection(
      `mongodb://${host}/legacy_migration_rehearsal?replicaSet=${replicaSet}`,
      {
        serverSelectionTimeoutMS: 15000,
      },
    );
    try {
      await run(await connection.asPromise());
    } finally {
      await connection.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    lines.close();
  }
}

async function materializeSample(
  orders: Model<ClubOrder>,
  origins: mongo.Collection<Origin>,
  review: Review,
) {
  const key = sourceKey(verifiedSample);
  const booking = review.rows.booking.find((row) => sourceKey(row) === key);
  const claim = review.manualClaims.find((item) => item.source === key);
  assert(booking && claim, `找不到演练预约 ${key}`);
  const sendingAccount = review.rows.songxinhao.find(
    (row) => sourceKey(row) === claim.sendingAccount.source,
  );
  assert(sendingAccount, `无法核对 ${key} 的送心号`);
  const session = await orders.db.startSession();
  try {
    return await session.withTransaction(async () => {
      const previous = await origins.findOne({ _id: key }, { session });
      if (previous) {
        const order = await orders
          .findById(previous.orderId)
          .session(session)
          .lean();
        assert(order, `找不到 ${key} 对应的演练草稿`);
        const differences = {
          booking: fieldChanges(previous.booking, booking),
          sendingAccount: fieldChanges(previous.sendingAccount, sendingAccount),
        };
        return {
          status:
            differences.booking.length || differences.sendingAccount.length
              ? 'source_changed'
              : 'unchanged',
          differences,
          order,
        };
      }

      const duplicateGroups = Object.values(review.possibleDuplicates).flat();
      assert(
        !duplicateGroups.some((group) => group.records.includes(key)),
        '演练样单存在待核对的疑似重复',
      );
      assert.equal(booking.fields.total, verifiedSample.requestedHearts);
      const order = await new orders({
        clubId: verifiedSample.clubId,
        source: 'direct_dispatch',
        businessType: 'heart_delivery',
        createdByUserId: verifiedSample.dispatcherUserId,
        requestId: verifiedSample.requestId,
        customerLabel: verifiedSample.customerLabel,
        customerLinkStatus: 'pending_verification',
        dispatcherUserId: verifiedSample.dispatcherUserId,
        dispatcherAssignment: 'creator',
        dispatchStatus: 'draft',
        recipientGameAccount: verifiedSample.recipientGameAccount,
        heartDelivery: { requestedHearts: verifiedSample.requestedHearts },
      }).save({ session });
      await origins.insertOne(
        { _id: key, orderId: order._id, booking, sendingAccount },
        { session },
      );
      return { status: 'created', order: order.toObject() };
    });
  } finally {
    await session.endSession();
  }
}

function writeFixture(path: string, inserts: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE booking(
        id INTEGER PRIMARY KEY, sid INTEGER, title TEXT, date TEXT, banban TEXT,
        paipai TEXT, zhipai TEXT, total INTEGER, shijiJiesuan TEXT, remark TEXT, created_at TEXT
      );
      CREATE TABLE songxinhao(id INTEGER PRIMARY KEY, name TEXT, candles INTEGER);
      ${inserts}
    `);
  } finally {
    db.close();
  }
}

async function rehearse(directory: string, connection: Connection) {
  const first = join(directory, 'first.db');
  const second = join(directory, 'second.db');
  const orders = connection.model(ClubOrder.name, ClubOrderSchema);
  const database = connection.getClient().db();
  const origins = await database.createCollection<Origin>(
    'rehearsal_order_origins',
  );
  await orders.init();
  writeFixture(
    first,
    `
    INSERT INTO songxinhao VALUES (17, '甲的送心号', 42), (18, '甲的备用号', 10);
    INSERT INTO booking VALUES
      (8, 17, '演练普通单', '2025-01-01', '老板甲', '派派甲', NULL, 50, '¥20.50', '原备注', '2025-01-01 09:00'),
      (9, 18, '疑似同单', '2025-01-02', '老板丙', '小青', '团员丙', 100, '¥10', NULL, NULL);
  `,
  );
  writeFixture(
    second,
    `
    INSERT INTO songxinhao VALUES (17, '乙的送心号', 11);
    INSERT INTO booking VALUES
      (8, 18, '另一笔预约', '2025-01-03', '同昵称老板', '小青,小兰', '待核实', 25, '¥12.34', NULL, NULL),
      (9, 17, '疑似同单', '2025-01-02', '老板丙', '小青', '团员丁', 50, '¥5', NULL, NULL);
  `,
  );

  const sources = [
    { ownerUserId: '00A1', path: first },
    { ownerUserId: '00B2', path: second },
  ];
  const baseline = readLegacySnapshot(sources);
  const review = reviewLegacySnapshot(baseline);
  assert.deepEqual(review.localIdCollisions.booking, [
    { key: '8', records: ['00A1:8', '00B2:8'] },
    { key: '9', records: ['00A1:9', '00B2:9'] },
  ]);
  assert.deepEqual(review.localIdCollisions.songxinhao, [
    { key: '17', records: ['00A1:17', '00B2:17'] },
  ]);
  assert.deepEqual(
    review.manualClaims.map((item) => item.sendingAccount),
    [
      { status: 'found', source: '00A1:17' },
      { status: 'found', source: '00A1:18' },
      { status: 'missing', source: '00B2:18' },
      { status: 'found', source: '00B2:17' },
    ],
  );
  assert.deepEqual(review.possibleDuplicates.sameTitleAndDate[0]?.records, [
    '00A1:9',
    '00B2:9',
  ]);
  assert.deepEqual(review.possibleDuplicates.sameCustomerAndDate[0]?.records, [
    '00A1:9',
    '00B2:9',
  ]);

  const initial = await materializeSample(orders, origins, review);
  assert.equal(initial.status, 'created');
  const replay = await materializeSample(
    orders,
    origins,
    reviewLegacySnapshot(readLegacySnapshot([...sources].reverse())),
  );
  assert.equal(replay.status, 'unchanged');
  assert.deepEqual(replay.order, initial.order);

  const changedSource = new DatabaseSync(first);
  try {
    changedSource.exec(`
      UPDATE booking SET remark = '改后的备注' WHERE id = 8;
      UPDATE songxinhao SET candles = 43 WHERE id = 17;
      INSERT INTO booking (id, title) VALUES (10, '补发现的记录');
      DELETE FROM booking WHERE id = 9;
    `);
  } finally {
    changedSource.close();
  }
  const changedReview = reviewLegacySnapshot(
    readLegacySnapshot(sources),
    baseline,
  );
  const changed = await materializeSample(orders, origins, changedReview);
  assert.equal(changed.status, 'source_changed');
  assert.deepEqual(changed.differences?.booking, [
    { field: 'remark', before: '原备注', after: '改后的备注' },
  ]);
  assert.deepEqual(changed.differences?.sendingAccount, [
    { field: 'candles', before: 42, after: 43 },
  ]);
  assert.deepEqual(changed.order, initial.order);
  assert.deepEqual(
    changedReview.differences?.map((entry) => entry.changed),
    [
      [{ source: '00A1:8', fields: changed.differences?.booking }],
      [{ source: '00A1:17', fields: changed.differences?.sendingAccount }],
    ],
  );
  assert.deepEqual(changedReview.differences?.[0].added.map(sourceKey), [
    '00A1:10',
  ]);
  assert.deepEqual(changedReview.differences?.[0].removed.map(sourceKey), [
    '00A1:9',
  ]);

  const manualClaims = review.manualClaims.filter(
    (item) => item.source !== sourceKey(verifiedSample),
  );
  assert.deepEqual(
    manualClaims.map((item) => item.source),
    ['00A1:9', '00B2:8', '00B2:9'],
  );
  const savedOrigins = await origins.find().toArray();
  assert.equal(savedOrigins.length, 1);
  const [origin] = savedOrigins;
  assert.equal(origin._id, sourceKey(verifiedSample));
  assert.deepEqual(origin.orderId, initial.order._id);
  assert.equal(origin.booking.fields.shijiJiesuan, '¥20.50');
  assert.equal(origin.booking.fields.remark, '原备注');
  assert.equal(origin.sendingAccount.fields.candles, 42);
  await assert.rejects(origins.insertOne(origin), {
    code: 11000,
    keyPattern: { _id: 1 },
  });
  // A different document ID still conflicts on the real P1-02 order submission key.
  await assert.rejects(
    orders.create({ ...initial.order, _id: new Types.ObjectId() }),
    {
      code: 11000,
      keyPattern: { clubId: 1, source: 1, createdByUserId: 1, requestId: 1 },
    },
  );
  const saved = await orders.find().lean();
  assert.deepEqual(saved, [initial.order]);
  assert.deepEqual(Object.keys(saved[0]).sort(), [
    '_id',
    'businessType',
    'clubId',
    'createdAt',
    'createdByUserId',
    'customerLabel',
    'customerLinkStatus',
    'dispatchStatus',
    'dispatcherAssignment',
    'dispatcherUserId',
    'heartDelivery',
    'recipientGameAccount',
    'requestId',
    'shares',
    'source',
    'updatedAt',
  ]);
  assert.deepEqual(
    (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .sort(),
    ['club_orders', 'rehearsal_order_origins'],
  );

  console.log(
    JSON.stringify(
      {
        演练: '两份合成 SQLite 旧库与独立的临时 MongoDB',
        已应用: { source: sourceKey(verifiedSample), order: initial.order },
        重跑: replay.status,
        改动后重跑: changed.status,
        记录差异: changedReview.differences,
        同号记录: review.localIdCollisions,
        疑似同单: review.possibleDuplicates,
        人工核对: manualClaims,
      },
      null,
      2,
    ),
  );
}

async function run() {
  const directory = mkdtempSync(join(tmpdir(), 'sky-heart-migration-'));
  try {
    await withTemporaryMongo(directory, (connection) =>
      rehearse(directory, connection),
    );
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
