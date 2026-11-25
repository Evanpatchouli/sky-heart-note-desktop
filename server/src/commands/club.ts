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
  const [command, userId] = args;
  if (command !== 'init-leader' || args.length !== 2) {
    throw new Error('用法：club init-leader <四位用户ID>');
  }

  const app = await NestFactory.createApplicationContext(ClubCommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const directory = app.get(ClubDirectoryService);
    await directory.initializeLeader(userId);
    console.log('已初始化本俱乐部团长');
  } finally {
    await app.close();
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
