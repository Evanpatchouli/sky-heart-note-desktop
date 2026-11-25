import 'module-alias/register';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import AppConfig from '../app.config';
import { ClubModule } from '../modules/club';
import { ClubDirectoryService } from '../modules/club/club-directory.service';

const mongo = AppConfig.DataBase.Mongo;

@Module({
  imports: [
    MongooseModule.forRoot(
      mongo.CONNECTION,
      mongo.USERNAME ? { user: mongo.USERNAME, pass: mongo.PASSWORD } : {},
    ),
    ClubModule,
  ],
})
class ClubCommandModule {}

async function run(args: string[]) {
  const [command, clubId, value, status, mark] = args;
  const saveClub = command === 'club' && args.length === 3;
  const saveMember =
    command === 'member' &&
    args.length === 5 &&
    (status === 'active' || status === 'inactive') &&
    (mark === 'dispatcher' || mark === 'member');
  if (!saveClub && !saveMember) {
    throw new Error(
      '用法：club <俱乐部标识> <名称> 或 member <俱乐部标识> <四位用户ID> <active|inactive> <dispatcher|member>',
    );
  }

  const app = await NestFactory.createApplicationContext(ClubCommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const directory = app.get(ClubDirectoryService);
    if (saveClub) await directory.saveClub(clubId, value);
    else
      await directory.saveMember(
        clubId,
        value,
        status === 'active',
        mark === 'dispatcher',
      );
    console.log('已保存俱乐部配置');
  } finally {
    await app.close();
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
