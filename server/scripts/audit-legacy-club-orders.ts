import { realpathSync } from 'node:fs';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { USER_ID_PATTERN } from '@sky-club/common';

type Field =
  | null
  | number
  | string
  | { integer: string }
  | { real: string }
  | { blobBase64: string };
type LegacyRow = {
  ownerUserId: string;
  localId: string;
  fields: Record<string, Field>;
};
type Source = { ownerUserId: string; path: string };
type Table = 'booking' | 'songxinhao';
const tables = ['booking', 'songxinhao'] as const;

export function sourceKey(row: Pick<LegacyRow, 'ownerUserId' | 'localId'>) {
  return `${row.ownerUserId}:${row.localId}`;
}

function encodeField(value: SQLOutputValue): Field {
  if (value instanceof Uint8Array) {
    return { blobBase64: Buffer.from(value).toString('base64') };
  }
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || Object.is(value, -0))
  ) {
    return { real: Object.is(value, -0) ? '-0' : String(value) };
  }
  if (typeof value !== 'bigint') return value;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : { integer: value.toString() };
}

function* readRows(
  db: DatabaseSync,
  ownerUserId: string,
  table: Table,
): Generator<LegacyRow> {
  const statement = db.prepare(`SELECT * FROM main.${table} ORDER BY id`);
  statement.setReadBigInts(true);
  const ids = new Set<string>();
  for (const { id, ...fields } of statement.iterate()) {
    if (typeof id !== 'bigint') {
      throw new Error(`${ownerUserId}/${table} 存在非整数 id`);
    }
    const localId = id.toString();
    if (ids.has(localId)) {
      throw new Error(`${ownerUserId}/${table} 存在重复 id ${localId}`);
    }
    ids.add(localId);
    yield {
      ownerUserId,
      localId,
      fields: Object.fromEntries(
        Object.keys(fields)
          .sort()
          .map((name) => [name, encodeField(fields[name])]),
      ),
    };
  }
}

export function readLegacySnapshot(sources: readonly Source[]) {
  const owners = sources.map((source) => source.ownerUserId).sort();
  if (
    owners.length === 0 ||
    new Set(owners).size !== owners.length ||
    owners.some((owner) => !USER_ID_PATTERN.test(owner))
  )
    throw new Error('本批每份库必须对应一个不同的四位用户 ID');

  const files = new Map(
    sources.map((source) => [source.ownerUserId, realpathSync(source.path)]),
  );
  if (new Set(files.values()).size !== files.size) {
    throw new Error('同一份备份不能分配给多个所有者');
  }

  const rows: Record<Table, LegacyRow[]> = { booking: [], songxinhao: [] };
  for (const [owner, path] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('PRAGMA trusted_schema = OFF; BEGIN');
      const present = db
        .prepare(
          `
        SELECT name FROM pragma_table_list
        WHERE schema = 'main' AND type = 'table' AND name IN ('booking', 'songxinhao')
      `,
        )
        .all();
      if (!present.length) throw new Error(`${owner} 的备份中未找到旧业务表`);
      for (const table of tables) {
        if (present.some((row) => row.name === table)) {
          for (const row of readRows(db, owner, table)) rows[table].push(row);
        }
      }
    } finally {
      db.close();
    }
  }
  return { owners, rows };
}

type Snapshot = ReturnType<typeof readLegacySnapshot>;

function groupAcrossOwners(
  rows: LegacyRow[],
  hint: (row: LegacyRow) => string | undefined,
) {
  const groups = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const key = hint(row);
    if (key === undefined) continue;
    const matches = groups.get(key) ?? [];
    matches.push(row);
    groups.set(key, matches);
  }
  return [...groups].flatMap(([key, matches]) =>
    new Set(matches.map((row) => row.ownerUserId)).size > 1
      ? [{ key, records: matches.map(sourceKey) }]
      : [],
  );
}

function textField(value: Field | undefined) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function duplicateHint(field: 'title' | 'banban', row: LegacyRow) {
  const name = textField(row.fields[field]);
  const date = textField(row.fields.date);
  return name && date ? JSON.stringify([name, date]) : undefined;
}

export function fieldChanges(before: LegacyRow, after: LegacyRow) {
  const names = new Set([
    ...Object.keys(before.fields),
    ...Object.keys(after.fields),
  ]);
  return [...names].sort().flatMap((name) => {
    const oldValue = Object.hasOwn(before.fields, name)
      ? before.fields[name]
      : undefined;
    const newValue = Object.hasOwn(after.fields, name)
      ? after.fields[name]
      : undefined;
    return JSON.stringify(oldValue) === JSON.stringify(newValue)
      ? []
      : [
          {
            field: name,
            ...(oldValue === undefined ? {} : { before: oldValue }),
            ...(newValue === undefined ? {} : { after: newValue }),
          },
        ];
  });
}

function compareSnapshots(baseline: Snapshot, current: Snapshot) {
  if (JSON.stringify(baseline.owners) !== JSON.stringify(current.owners)) {
    throw new Error('基准与本批必须覆盖相同的所有者');
  }
  return tables.map((table) => {
    const previous = new Map(
      baseline.rows[table].map((row) => [sourceKey(row), row]),
    );
    const added: LegacyRow[] = [];
    const changed: {
      source: string;
      fields: ReturnType<typeof fieldChanges>;
    }[] = [];
    for (const row of current.rows[table]) {
      const source = sourceKey(row);
      const oldRow = previous.get(source);
      previous.delete(source);
      if (!oldRow) {
        added.push(row);
        continue;
      }
      const fields = fieldChanges(oldRow, row);
      if (fields.length) changed.push({ source, fields });
    }
    return { table, added, removed: [...previous.values()], changed };
  });
}

function sendingAccount(booking: LegacyRow, accounts: Map<string, LegacyRow>) {
  if (!Object.hasOwn(booking.fields, 'sid')) return { status: 'column_absent' };
  const sid = booking.fields.sid;
  if (sid === null) return { status: 'unset' };
  const id =
    typeof sid === 'number' && Number.isSafeInteger(sid)
      ? String(sid)
      : sid && typeof sid === 'object' && 'integer' in sid
        ? sid.integer
        : undefined;
  if (id === undefined) return { status: 'invalid' };
  const source = sourceKey({ ownerUserId: booking.ownerUserId, localId: id });
  return { status: accounts.has(source) ? 'found' : 'missing', source };
}

export function reviewLegacySnapshot(snapshot: Snapshot, baseline?: Snapshot) {
  const { booking, songxinhao } = snapshot.rows;
  const accounts = new Map(songxinhao.map((row) => [sourceKey(row), row]));
  const possibleDuplicates = {
    sameTitleAndDate: groupAcrossOwners(booking, (row) =>
      duplicateHint('title', row),
    ),
    sameCustomerAndDate: groupAcrossOwners(booking, (row) =>
      duplicateHint('banban', row),
    ),
  };
  return {
    ...snapshot,
    localIdCollisions: {
      booking: groupAcrossOwners(booking, (row) => row.localId),
      songxinhao: groupAcrossOwners(songxinhao, (row) => row.localId),
    },
    possibleDuplicates,
    manualClaims: booking.map((row) => ({
      source: sourceKey(row),
      sendingAccount: sendingAccount(row, accounts),
      check: [
        '订单来源与是否已有共享单',
        '客户与接收游戏账号',
        '订单发起人和派单人',
        '承接成员与份额',
        '购买数量与历史进度',
      ],
    })),
    ...(baseline ? { differences: compareSnapshots(baseline, snapshot) } : {}),
  };
}

function parseSources(args: string[]) {
  if (!args.length || args.length % 2 !== 0 || args.includes('--against')) {
    throw new Error('每份库须提供四位用户 ID 和文件路径');
  }
  const sources: Source[] = [];
  for (let i = 0; i < args.length; i += 2) {
    sources.push({ ownerUserId: args[i], path: args[i + 1] });
  }
  return sources;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    const against = args.indexOf('--against');
    const current = readLegacySnapshot(
      parseSources(against < 0 ? args : args.slice(0, against)),
    );
    const baseline =
      against < 0
        ? undefined
        : readLegacySnapshot(parseSources(args.slice(against + 1)));
    console.log(
      JSON.stringify(reviewLegacySnapshot(current, baseline), null, 2),
    );
  } catch (error) {
    console.error(
      '用法：audit-legacy-club-orders.ts <所有者 ID> <备份路径> […] [--against <所有者 ID> <原备份路径> …]',
    );
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
