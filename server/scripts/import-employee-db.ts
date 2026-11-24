import { config } from 'dotenv';
import { importDesktopDb } from '../src/modules/employee/import-desktop';

const [owner, source] = process.argv.slice(2);
if (!owner || !source) {
  console.error('用法: pnpm exec ts-node scripts/import-employee-db.ts <四位用户 ID> <旧 data.db 路径>');
  process.exitCode = 1;
} else {
  config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env', quiet: true });
  try {
    console.log('新增记录数', importDesktopDb(owner, source));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
