import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeeModule } from '../employee';
import { ClubGiftExecutionService } from './club-gift-execution.service';
import { RoleModule } from '../role-module';
import { UserDispatchActivationModule } from '../user-module/user-dispatch-activation.module';
import { User, UserSchema } from '../user-module/user.schema';
import { AdminClubController } from './admin-club.controller';
import { ClubCustomerService } from './club-customer.service';
import { ClubDirectoryService } from './club-directory.service';
import { ClubGiftDispatchController } from './club-gift-dispatch.controller';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';
import { ClientClubInvitationController, EmployeeClubInvitationController } from './club-member-invitation.controller';
import { ClubMemberInvitation, ClubMemberInvitationSchema, ClubMemberInvitationService } from './club-member-invitation.service';
import {
  ClientClubController,
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
    EmployeeModule,
    UserDispatchActivationModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Club.name, schema: ClubSchema },
      { name: ClubMember.name, schema: ClubMemberSchema },
      { name: ClubOrder.name, schema: ClubOrderSchema },
      { name: ClubMemberInvitation.name, schema: ClubMemberInvitationSchema },
    ]),
  ],
  controllers: [
    AdminClubController,
    ClubGiftDispatchController,
    ClientClubInvitationController,
    EmployeeClubInvitationController,
    EmployeeClubController,
    EmployeeClubOrderController,
    ClientClubController,
    ClientClubOrderController,
    ClientOwnOrdersController,
  ],
  providers: [ClubDirectoryService, ClubCustomerService, ClubOrderService, ClubGiftDispatchService, ClubMemberInvitationService, ClubGiftExecutionService],
  exports: [ClubDirectoryService, ClubOrderService],
})
export class ClubModule {}
