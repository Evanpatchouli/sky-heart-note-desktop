import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Match the desktop schema, including SQLite type affinity for existing rows.
export const recordColumns = {
  booking: {
    sid: 'INTEGER',
    title: 'TEXT',
    date: 'TEXT',
    banban: 'TEXT',
    paipai: 'TEXT',
    zhipai: 'TEXT',
    status: 'TEXT',
    total: 'INTEGER',
    yingchu: 'INTEGER',
    richu: 'INTEGER',
    yichu: 'INTEGER',
    jinriYichu: 'INTEGER',
    jinriStatus: 'TEXT',
    gongzi: 'TEXT',
    yuqiJiesuan: 'TEXT',
    shijiJiesuan: 'TEXT',
    jiesuo: 'INTEGER',
    yishan: 'INTEGER',
    pingbi: 'INTEGER',
    xiaoqun: 'TEXT',
    remark: 'TEXT',
    pinglun: 'TEXT',
  },
  songxinhao: {
    name: 'TEXT',
    candles: 'INTEGER',
    remark: 'TEXT',
  },
} as const;

export type RecordTable = keyof typeof recordColumns;

const createRecordTables = Object.entries(recordColumns).map(([table, fields]) => {
  const columns = Object.entries(fields).map(([name, type]) => `${name} ${type}`);
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id INTEGER PRIMARY KEY, ${columns.join(', ')}, created_at TEXT, updated_at TEXT
  );`;
}).join('\n');

export function employeeDbPath(owner: string, directory: string) {
  if (!/^[\da-f]{24}$/i.test(owner)) {
    throw new Error('需要提供有效的 MongoDB 用户 ID');
  }
  return resolve(directory, owner.toLowerCase() + '.db');
}

export function withEmployeeDb<T>(
  owner: string,
  action: (db: DatabaseSync) => T,
  directory = process.env.EMPLOYEE_DATA_DIR || 'data/employee',
): T {
  const filename = employeeDbPath(owner, directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      ${createRecordTables}
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS shared_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    return action(db);
  } finally {
    db.close();
  }
}
