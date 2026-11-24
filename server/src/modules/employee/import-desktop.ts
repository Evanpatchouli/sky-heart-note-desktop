import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { employeeDbPath, recordColumns, withEmployeeDb } from './database';

const desktopColumns = {
  booking: ['id', ...Object.keys(recordColumns.booking), 'created_at', 'updated_at'],
  songxinhao: ['id', ...Object.keys(recordColumns.songxinhao), 'created_at', 'updated_at'],
  kv: ['key', 'value', 'created_at', 'updated_at'],
};

export function importDesktopDb(
  owner: string,
  source: string,
  directory = process.env.EMPLOYEE_DATA_DIR || 'data/employee',
) {
  const path = realpathSync(source);
  if (path === employeeDbPath(owner, directory)) throw new Error('源数据库与目标数据库相同');
  const uri = pathToFileURL(path);
  uri.searchParams.set('mode', 'ro');

  return withEmployeeDb(owner, db => {
    db.prepare('ATTACH DATABASE ? AS desktop').run(uri.href);
    db.exec('PRAGMA trusted_schema = OFF; BEGIN IMMEDIATE');
    try {
      const result: Record<string, number> = {};
      for (const [table, fields] of Object.entries(desktopColumns)) {
        const exists = db.prepare("SELECT 1 FROM desktop.sqlite_schema WHERE type = 'table' AND name = ?").get(table);
        if (!exists) continue;
        const columns = db.prepare(`PRAGMA desktop.table_info(${table})`).all().map(row => String(row.name));
        const key = fields[0];
        if (!columns.includes(key) || columns.some(name => !fields.includes(name))) {
          throw new Error(`无法识别 ${table} 的表结构`);
        }
        // Column names and table names above are checked against the desktop schema.
        const selection = columns.join(', ');
        const sameKey = `EXISTS (SELECT 1 FROM main.${table} target WHERE target.${key} IS src.${key})`;
        const difference = db.prepare(`
          SELECT ${selection} FROM desktop.${table} src WHERE ${sameKey}
          EXCEPT SELECT ${selection} FROM main.${table}
          LIMIT 1
        `).get();
        if (difference) throw new Error(`${table} 存在内容不同的同键记录，已取消导入`);
        const inserted = db.prepare(`
          INSERT INTO main.${table} (${selection})
          SELECT ${selection} FROM desktop.${table} src WHERE NOT ${sameKey}
        `).run();
        result[table] = Number(inserted.changes);
      }
      if (!Object.keys(result).length) throw new Error('没有找到桌面端的业务表');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }, directory);
}
