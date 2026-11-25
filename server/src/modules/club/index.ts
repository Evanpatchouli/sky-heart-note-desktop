import { ClubDailyReportStore } from './club-daily-report.store';
import { ClubDeliveryController } from './club-delivery.controller';
import { DailyReport, DailyReportSchema } from './club-delivery.schema';
import { ClubGiftDeliveryService } from './club-gift-delivery.service';
import { ClubGiftSupervision } from './club-gift-supervision';
import { ClientGiftPriceAdjustmentController, EmployeeGiftPriceAdjustmentController } from './club-gift-price-adjustment.controller';
import { ClubGiftPriceAdjustmentService } from './club-gift-price-adjustment.service';
import { ClientContinuationController, EmployeeContinuationController } from './club-continuation.controller';
import { ClubContinuationService } from './club-continuation.service';
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
import { ClubDispatchNoticeController } from './club-dispatch-notice.controller';
import { ClubDispatchNotice, ClubDispatchNoticeSchema } from './club-dispatch-notice.schema';
import { ClubDispatchNoticeService } from './club-dispatch-notice.service';
import { AppSessionModule } from '../../auth/app-session.module';
import { ClubDispatchPushController } from './club-dispatch-push.controller';
import { ClubDispatchPushDelivery, ClubDispatchPushDeliverySchema, ClubDispatchPushSubscription, ClubDispatchPushSubscriptionSchema } from './club-dispatch-push.schema';
import { ClubDispatchPushService } from './club-dispatch-push.service';
import { AdminAppNotificationController, ClientAppNotificationController, EmployeeAppNotificationController } from './app-notification.controller';
import { AppNotificationEvent, AppNotificationEventSchema } from './app-notification.schema';
import { AppNotificationService } from './app-notification.service';
import { EmployeeClubOperationsController } from './employee-club-operations.controller';
import { ClubGiftDispatchController } from './club-gift-dispatch.controller';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';
import { ClientClubInvitationController, EmployeeClubInvitationController } from './club-member-invitation.controller';
import { ClubMemberInvitation, ClubMemberInvitationSchema, ClubMemberInvitationService } from './club-member-invitation.service';
import {
  ClientClubController,
  ClientClubOrderController,
  EmployeeClubController,
  EmployeeClubOrderController,
} from './club-order.controller';
import { ClubOrder, ClubOrderSchema } from './club-order.schema';
import { ClubOrderService } from './club-order.service';
import { ClubPromotionCoupon, ClubPromotionCouponSchema } from './club-promotion.schema';
import { ClubPromotionService } from './club-promotion.service';
import { ClubGiftSettlementService } from './club-gift-settlement.service';
import { ClubSettlementCorrectionController } from './club-settlement-correction.controller';
import { ClubSettlementCorrectionService } from './club-settlement-correction.service';
import { ClubSettlementEvidenceService } from './club-settlement-evidence.service';
import { ClubFinancialAdjustment, ClubFinancialAdjustmentSchema } from './club-financial-adjustment.schema';
import { AdminClubFinancialAdjustmentController, EmployeeClubFinancialAdjustmentController } from './club-financial-adjustment.controller';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';
import { ClubSettlementCalculation, ClubSettlementCalculationSchema, ClubSettlementEvidence, ClubSettlementEvidenceSchema } from './club-settlement.schema';
import { Club, ClubMember, ClubMemberSchema, ClubSchema } from './club.schema';

@Module({
  imports: [
    RoleModule,
    AppSessionModule,
    EmployeeModule,
    UserDispatchActivationModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Club.name, schema: ClubSchema },
      { name: ClubMember.name, schema: ClubMemberSchema },
      { name: ClubOrder.name, schema: ClubOrderSchema },
      { name: ClubDispatchNotice.name, schema: ClubDispatchNoticeSchema },
      { name: AppNotificationEvent.name, schema: AppNotificationEventSchema },
      { name: ClubDispatchPushSubscription.name, schema: ClubDispatchPushSubscriptionSchema },
      { name: ClubDispatchPushDelivery.name, schema: ClubDispatchPushDeliverySchema },
      { name: ClubPromotionCoupon.name, schema: ClubPromotionCouponSchema },
      { name: DailyReport.name, schema: DailyReportSchema },
      { name: ClubSettlementCalculation.name, schema: ClubSettlementCalculationSchema },
      { name: ClubSettlementEvidence.name, schema: ClubSettlementEvidenceSchema },
      { name: ClubFinancialAdjustment.name, schema: ClubFinancialAdjustmentSchema },
      { name: ClubMemberInvitation.name, schema: ClubMemberInvitationSchema },
    ]),
  ],
  controllers: [
    ClubSettlementCorrectionController,
    AdminClubFinancialAdjustmentController,
    EmployeeClubFinancialAdjustmentController,
    ClientGiftPriceAdjustmentController,
    EmployeeGiftPriceAdjustmentController,
    ClientContinuationController,
    EmployeeContinuationController,
    AdminClubController,
    ClubGiftDispatchController,
    ClubDeliveryController,
    ClubDispatchNoticeController,
    ClubDispatchPushController,
    AdminAppNotificationController,
    EmployeeAppNotificationController,
    ClientAppNotificationController,
    ClientClubInvitationController,
    EmployeeClubInvitationController,
    EmployeeClubController,
    EmployeeClubOperationsController,
    EmployeeClubOrderController,
    ClientClubController,
    ClientClubOrderController,
  ],
  providers: [ClubSettlementCorrectionService, ClubFinancialAdjustmentService, ClubPromotionService, ClubContinuationService, ClubGiftPriceAdjustmentService, ClubGiftSupervision, ClubDirectoryService, ClubCustomerService, ClubOrderService, ClubGiftDispatchService, ClubMemberInvitationService, ClubGiftExecutionService, ClubDailyReportStore, ClubGiftDeliveryService, ClubDispatchNoticeService, ClubDispatchPushService, AppNotificationService, ClubGiftSettlementService, ClubSettlementEvidenceService],
  exports: [ClubDirectoryService, ClubOrderService, AppNotificationService],
})
export class ClubModule {}
