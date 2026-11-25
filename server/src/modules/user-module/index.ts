import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UserController } from './user.controller';
import { UserModel } from './user.model';
import { UserLoginService } from './user.service.login';
import { UserRoleService } from './user.service.role';
import { RoleModule } from '../role-module';
import { AppSession, AppSessionSchema } from '@/auth/app-session.schema';
import { AppSessionService } from '@/auth/app-session.service';
import { CaptchaModule } from '../captcha-module';
import { OPTModule } from '../opt-module';
import { UserManageService } from './user.service.manage';
import { UserDispatchActivationModule } from './user-dispatch-activation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AppSession.name, schema: AppSessionSchema },
    ]),
    RoleModule,
    CaptchaModule,
    OPTModule,
    UserDispatchActivationModule,
  ],
  controllers: [UserController],
  providers: [
    UserModel,
    UserLoginService,
    UserRoleService,
    AppSessionService,
    UserManageService,
  ],
  exports: [AppSessionService, UserRoleService, UserManageService],
})
export class UserModule {}
