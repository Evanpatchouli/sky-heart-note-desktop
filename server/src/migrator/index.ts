import { MigrationManager } from './migration-manager';
import AppConfig from '../app.config';
import { logger } from '@/common/logger';
import { v1 } from './v1';
import { v3 } from './v3';

const MigratorConfig = AppConfig.Migrator;

export const migrate = async () => {
  if (!MigratorConfig.on) {
    return;
  }

  logger.info('🚀 开始执行数据迁移...');

  const mongo = AppConfig.DataBase.Mongo;
  const manager = new MigrationManager(mongo.CONNECTION, {
    ...(mongo.USERNAME ? { user: mongo.USERNAME, pass: mongo.PASSWORD } : {}),
  });

  try {
    // 注册所有迁移脚本
    manager.register({
      version: 'v1',
      name: '初始化权限和角色数据',
      up: v1,
    });

    manager.register({
      version: 'v3',
      name: '初始化 Web 应用登录角色',
      up: v3,
    });

    await manager.connect();

    // 运行迁移
    await manager.run({ force: false });

    logger.info('✅ 数据库迁移成功');
  } catch (error) {
    logger.error('❌ 数据库迁移失败:', error);
    throw error;
  } finally {
    await manager.disconnect();
  }
};
