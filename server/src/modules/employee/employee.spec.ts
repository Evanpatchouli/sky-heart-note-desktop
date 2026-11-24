import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { employeeDbPath, withEmployeeDb } from './database';
import { EmployeeService } from './employee.service';
import { importDesktopDb } from './import-desktop';

describe('员工数据', () => {
  const first = '0123456789abcdef00000001';
  const second = '0123456789abcdef00000002';
  const service = new EmployeeService();
  const previousDir = process.env.EMPLOYEE_DATA_DIR;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sky-heart-employee-'));
    process.env.EMPLOYEE_DATA_DIR = directory;
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.EMPLOYEE_DATA_DIR;
    else process.env.EMPLOYEE_DATA_DIR = previousDir;
    rmSync(directory, { recursive: true, force: true });
  });

  it('按账号隔离数字 ID，局部更新保留未修改列', () => {
    const id = service.create(first, 'booking', { title: '初稿', remark: '原备注' });
    expect(service.create(second, 'booking', { title: '其他员工' })).toBe(id);
    expect(service.update(first, 'booking', id, { title: '更新', yichu: 3 })).toBe(true);
    expect(service.list(first, 'booking')).toMatchObject([{ id, title: '更新', remark: '原备注', yichu: 3 }]);
    expect(service.list(second, 'booking')).toMatchObject([{ id, title: '其他员工' }]);
    expect(service.update(first, 'booking', id + 1, { remark: '' })).toBe(false);
    expect(service.remove(first, 'booking', id)).toBe(true);
    expect(service.remove(first, 'booking', id)).toBe(false);
    expect(service.list(second, 'booking')).toHaveLength(1);
  });

  it('送心号保留蜡烛数，输入只允许业务列和标量', () => {
    const id = service.create(first, 'songxinhao', { name: '甲', candles: 8 });
    expect(service.update(first, 'songxinhao', id, { remark: '备注' })).toBe(true);
    expect(service.list(first, 'songxinhao')).toMatchObject([{ id, name: '甲', candles: 8, remark: '备注' }]);
    expect(() => service.update(first, 'songxinhao', id, { owner: second })).toThrow();
    expect(() => service.create(first, 'booking', { title: {} })).toThrow();
    expect(service.remove(first, 'songxinhao', id)).toBe(true);
    service.create(first, 'songxinhao', { name: '乙' });
    expect(service.list(first, 'songxinhao')).toMatchObject([{ name: '乙', candles: 0 }]);
  });

  it('共享变量原子注册、逐项删除和清空均限定在账号内', () => {
    const state = { key: '__proto__', value: '"原值"', ifNotExists: true };
    expect(service.writeShared(first, state)).toBe(true);
    expect(service.writeShared(first, { ...state, value: '2' })).toBe(false);
    expect(service.sharedState(first)[state.key]).toBe(state.value);
    expect(service.sharedState(second)).toEqual({});
    expect(service.writeShared(second, { key: 'second', value: '2' })).toBe(true);
    service.removeShared(first, state.key);
    expect(service.sharedState(first)).toEqual({});
    service.writeShared(first, { key: 'first', value: '1' });
    service.removeShared(first);
    expect(service.sharedState(first)).toEqual({});
    expect(service.sharedState(second)).toEqual({ second: '2' });
  });

  it('原始记录和关系可重复导入，跨表冲突时整批回滚', () => {
    const source = join(directory, 'data.db');
    const old = new DatabaseSync(source);
    old.exec(`
      CREATE TABLE booking(id INTEGER PRIMARY KEY, sid INTEGER, title TEXT, created_at TEXT);
      INSERT INTO booking VALUES(8, 17, '旧订单', '2024-01-01 09:30:00');
      CREATE TABLE songxinhao(id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO songxinhao VALUES(17, '旧账号');
      CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO kv VALUES('theme', 'dark');
    `);
    old.close();
    expect(importDesktopDb(first, source)).toEqual({ booking: 1, songxinhao: 1, kv: 1 });
    expect(importDesktopDb(first, source)).toEqual({ booking: 0, songxinhao: 0, kv: 0 });
    expect(service.list(first, 'booking')).toMatchObject([{ id: 8, sid: 17, created_at: '2024-01-01 09:30:00' }]);
    expect(withEmployeeDb(first, db => db.prepare("SELECT value FROM kv WHERE key='theme'").get())).toMatchObject({ value: 'dark' });
    expect(service.create(first, 'booking', { title: '新订单' })).toBe(9);

    const changed = new DatabaseSync(source);
    changed.exec("INSERT INTO booking VALUES(10, NULL, '新增', NULL); UPDATE songxinhao SET name='冲突'");
    changed.close();
    expect(() => importDesktopDb(first, source)).toThrow('同键记录');
    expect(service.list(first, 'booking').map(row => row.id)).toEqual([8, 9]);
    expect(service.list(first, 'songxinhao')).toMatchObject([{ id: 17, name: '旧账号' }]);
    expect(() => employeeDbPath('../other', directory)).toThrow();
  });
});
