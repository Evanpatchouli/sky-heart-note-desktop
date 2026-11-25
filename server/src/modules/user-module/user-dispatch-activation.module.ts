import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleModule } from '../role-module';
import { UserDispatchActivationService } from './user-dispatch-activation.service';
import { User, UserSchema } from './user.schema';

@Module({
  imports: [RoleModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [UserDispatchActivationService],
  exports: [UserDispatchActivationService],
})
export class UserDispatchActivationModule {}
