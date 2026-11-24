import { env } from './config/env';

export default class AppConfig {
  public static readonly Process = {
    ROOT: process.cwd(),
  };
  public static readonly Server = {
    HOST: env.APP_HOST || '0.0.0.0',
    PORT: env.APP_PORT || 8793,
  };

  public static readonly DataBase = {
    Mongo: {
      CONNECTION: env.DB_MONGO_CONNECTION as string,
      USERNAME: env.DB_MONGO_USERNAME as string,
      PASSWORD: env.DB_MONGO_PASSWORD as string,
    } as const,
  };

  public static readonly Migrator = {
    on: env.MIGRATE_ON_START,
  };

  public static readonly Log4js = {
    level: env.LOG_LEVEL || 'info',
    path: './logs',
    prefix: '',
    // prefix: '【萌宠空间】'
  } as const;

  public static readonly Session = {
    secret: env.SESSION_SECRET,
  };

  public static readonly SMTP = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  };
}
