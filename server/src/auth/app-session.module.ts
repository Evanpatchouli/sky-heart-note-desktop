import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleModule } from '../modules/role-module';
import { UserModel } from '../modules/user-module/user.model';
import { User, UserSchema } from '../modules/user-module/user.schema';
import { AppSession, AppSessionSchema } from './app-session.schema';
import { AppSessionService } from './app-session.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AppSession.name, schema: AppSessionSchema },
    ]),
    RoleModule,
  ],
  providers: [UserModel, AppSessionService],
  exports: [UserModel, AppSessionService],
})
export class AppSessionModule {}
