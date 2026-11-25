import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserLoginService } from './user.service.login';
import { UserRoleService } from './user.service.role';
import { RoleModule } from '../role-module';
import { AppSessionModule } from '@/auth/app-session.module';
import { CaptchaModule } from '../captcha-module';
import { OPTModule } from '../opt-module';
import { UserManageService } from './user.service.manage';
import { UserDispatchActivationModule } from './user-dispatch-activation.module';

@Module({
  imports: [
    AppSessionModule,
    RoleModule,
    CaptchaModule,
    OPTModule,
    UserDispatchActivationModule,
  ],
  controllers: [UserController],
  providers: [
    UserLoginService,
    UserRoleService,
    UserManageService,
  ],
  exports: [AppSessionModule, UserRoleService, UserManageService],
})
export class UserModule {}
