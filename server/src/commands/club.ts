import 'module-alias/register';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import AppConfig from '../app.config';
import { ClubModule } from '../modules/club';
import { ClubDirectoryService } from '../modules/club/club-directory.service';
import {
  CLUB_PERMISSIONS,
  isClubPermission,
} from '../modules/club/club-permissions';

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
  const changePermission =
    (command === 'grant' || command === 'revoke') &&
    args.length === 4 &&
    isClubPermission(status);
  if (!saveClub && !saveMember && !changePermission) {
    throw new Error(
      [
        '用法：club <俱乐部标识> <名称>',
        '      member <俱乐部标识> <四位用户ID> <active|inactive> <dispatcher|member>',
        `      <grant|revoke> <俱乐部标识> <四位用户ID> <${CLUB_PERMISSIONS.join('|')}>`,
      ].join('\n'),
    );
  }

  const app = await NestFactory.createApplicationContext(ClubCommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const directory = app.get(ClubDirectoryService);
    if (saveClub) await directory.saveClub(clubId, value);
    else if (saveMember)
      await directory.saveMember(
        clubId,
        value,
        status === 'active',
        mark === 'dispatcher',
      );
    else if (changePermission)
      await directory.setAdminPermission(
        clubId,
        value,
        status,
        command === 'grant',
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
