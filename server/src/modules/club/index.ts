import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleModule } from '../role-module';
import { UserDispatchActivationModule } from '../user-module/user-dispatch-activation.module';
import { User, UserSchema } from '../user-module/user.schema';
import { AdminClubController } from './admin-club.controller';
import { ClubCustomerService } from './club-customer.service';
import { ClubDirectoryService } from './club-directory.service';
import {
  ClientClubOrderController,
  ClientOwnOrdersController,
  EmployeeClubController,
  EmployeeClubOrderController,
} from './club-order.controller';
import { ClubOrder, ClubOrderSchema } from './club-order.schema';
import { ClubOrderService } from './club-order.service';
import { Club, ClubMember, ClubMemberSchema, ClubSchema } from './club.schema';

@Module({
  imports: [
    RoleModule,
    UserDispatchActivationModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Club.name, schema: ClubSchema },
      { name: ClubMember.name, schema: ClubMemberSchema },
      { name: ClubOrder.name, schema: ClubOrderSchema },
    ]),
  ],
  controllers: [
    AdminClubController,
    EmployeeClubController,
    EmployeeClubOrderController,
    ClientClubOrderController,
    ClientOwnOrdersController,
  ],
  providers: [ClubDirectoryService, ClubCustomerService, ClubOrderService],
  exports: [ClubDirectoryService],
})
export class ClubModule {}
