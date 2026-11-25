import 'module-alias/register';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import AppConfig from '../app.config';
import { ClubModule } from '../modules/club';
import { ClubDirectoryService } from '../modules/club/club-directory.service';
import { parseApp } from '../auth/app-access';
import { noticeTypes, type NoticeType } from '../modules/club/app-notification.schema';
import { AppNotificationService } from '../modules/club/app-notification.service';
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
  const [command, appOrUser, rawType, eventKey, recipientList, title, body] = args;
  const type = rawType as NoticeType;
  if (!(command === 'init-leader' && args.length === 2) &&
      !(command === 'notify' && (args.length === 6 || args.length === 7) && noticeTypes.includes(type))) {
    throw new Error('用法：club init-leader <四位用户ID> 或 club notify <应用> <normal|important|system> <事件键> <用户ID[,用户ID]> <标题> [内容]');
  }

  const app = await NestFactory.createApplicationContext(ClubCommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    if (command === 'init-leader') {
      await app.get(ClubDirectoryService).initializeLeader(appOrUser);
      console.log('已初始化本俱乐部团长');
    } else {
      const receipt = await app.get(AppNotificationService).publish({
        targetApp: parseApp(appOrUser), eventKey, type, recipientUserIds: recipientList.split(','), title, body,
      });
      console.log(JSON.stringify(receipt));
    }
  } finally {
    await app.close();
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + '\n', () => process.exit(1));
});
