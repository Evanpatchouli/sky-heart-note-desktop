import { BadRequestException, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { recordColumns, type RecordTable, withEmployeeDb } from './database';

function objectBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function writableFields(table: RecordTable, input: unknown) {
  const result: [string, string | number | null][] = [];
  for (const [key, value] of Object.entries(objectBody(input))) {
    if (['id', 'created_at', 'updated_at'].includes(key)) continue;
    if (!Object.hasOwn(recordColumns[table], key)) {
      throw new BadRequestException(`未知字段 ${key}`);
    }
    if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      result.push([key, value as string | number | null]);
    } else if (typeof value === 'boolean' && ['jiesuo', 'yishan', 'pingbi'].includes(key)) {
      result.push([key, Number(value)]);
    } else {
      throw new BadRequestException(`无效的字段值 ${key}`);
    }
  }
  if (!result.length) throw new BadRequestException('至少需要一个业务字段');
  return result;
}

function shareKey(key: unknown): string {
  if (typeof key !== 'string') throw new BadRequestException('共享键必须为字符串');
  return key;
}

function recordTimestamp(table: RecordTable) {
  return table === 'booking' ? dayjs().format('YYYY-MM-DD HH:mm:ss') : new Date().toISOString();
}

@Injectable()
export class EmployeeService {
  settings(owner: string) {
    return withEmployeeDb(owner, db => db.prepare('SELECT key, value, created_at, updated_at FROM kv ORDER BY key').all());
  }

  setSetting(owner: string, key: string, value: unknown) {
    if (typeof value !== 'string' && value !== null) throw new BadRequestException('设置值必须为字符串或 null');
    const now = new Date().toISOString();
    return withEmployeeDb(owner, db => Boolean(db.prepare(
      'INSERT INTO kv (key, value, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(key, value, now, now).changes));
  }

  deleteSetting(owner: string, key: string) {
    return withEmployeeDb(owner, db => Boolean(db.prepare('DELETE FROM kv WHERE key = ?').run(key).changes));
  }

  list(owner: string, table: RecordTable) {
    return withEmployeeDb(owner, db => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  }

  create(owner: string, table: RecordTable, input: unknown) {
    const fields = writableFields(table, input);
    if (table === 'songxinhao' && !fields.some(([name]) => name === 'candles')) {
      fields.push(['candles', 0]);
    }
    const names = fields.map(([name]) => name);
    const values = fields.map(([, value]) => value);
    const now = recordTimestamp(table);
    return withEmployeeDb(owner, db => {
      const sql = `INSERT INTO ${table} (${names.join(', ')}, created_at, updated_at)
        VALUES (${fields.map(() => '?').join(', ')}, ?, ?)`;
      return Number(db.prepare(sql).run(...values, now, now).lastInsertRowid);
    });
  }

  update(owner: string, table: RecordTable, id: number, input: unknown) {
    const fields = writableFields(table, input);
    const sets = fields.map(([name]) => `${name} = ?`);
    const values = fields.map(([, value]) => value);
    return withEmployeeDb(owner, db => {
      const sql = `UPDATE ${table} SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`;
      return Boolean(db.prepare(sql).run(...values, recordTimestamp(table), id).changes);
    });
  }

  remove(owner: string, table: RecordTable, id: number) {
    return withEmployeeDb(owner, db => Boolean(db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes));
  }

  sharedState(owner: string): Record<string, string> {
    return withEmployeeDb(owner, db => {
      const rows = db.prepare('SELECT key, value FROM shared_state').all();
      return Object.fromEntries(rows.map(({ key, value }) => [key, value])) as Record<string, string>;
    });
  }

  writeShared(owner: string, input: unknown) {
    const { key, value, ifNotExists = false } = objectBody(input);
    const name = shareKey(key);
    if (typeof value !== 'string' || typeof ifNotExists !== 'boolean') {
      throw new BadRequestException('需要字符串 value 和布尔值 ifNotExists');
    }
    const onConflict = ifNotExists ? 'DO NOTHING' : 'DO UPDATE SET value = excluded.value';
    return withEmployeeDb(owner, db => Boolean(db.prepare(
      `INSERT INTO shared_state (key, value) VALUES (?, ?) ON CONFLICT(key) ${onConflict}`,
    ).run(name, value).changes));
  }

  removeShared(owner: string, key?: unknown) {
    return withEmployeeDb(owner, db => {
      if (key === undefined) db.exec('DELETE FROM shared_state');
      else db.prepare('DELETE FROM shared_state WHERE key = ?').run(shareKey(key));
      return true;
    });
  }
}
