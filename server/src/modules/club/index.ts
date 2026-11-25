import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeeModule } from '../employee';
import { RoleModule } from '../role-module';
import { UserDispatchActivationModule } from '../user-module/user-dispatch-activation.module';
import { User, UserSchema } from '../user-module/user.schema';
import { AppSessionModule } from '../../auth/app-session.module';
import { AdminClubController } from './admin-club.controller';
import { ClubClaimController } from './club-claim.controller';
import { ClubClaimService } from './club-claim.service';
import { ClubCustomerService } from './club-customer.service';
import { ClubDashboardController } from './club-dashboard.controller';
import { ClubDashboardService } from './club-dashboard.service';
import { ClubDailyReportStore } from './club-daily-report.store';
import { ClubDeliveryController } from './club-delivery.controller';
import { DailyReport, DailyReportSchema } from './club-delivery.schema';
import { ClubDeliveryService } from './club-delivery.service';
import { ClubDirectoryService } from './club-directory.service';
import { EmployeeClubOperationsController } from './employee-club-operations.controller';
import { ClubGiftDispatchController } from './club-gift-dispatch.controller';
import { ClubGiftDispatchService } from './club-gift-dispatch.service';
import { ClubGiftDeliveryService } from './club-gift-delivery.service';
import { ClubGiftSupervision } from './club-gift-supervision';
import { ClientGiftPriceAdjustmentController, EmployeeGiftPriceAdjustmentController } from './club-gift-price-adjustment.controller';
import { ClubGiftPriceAdjustmentService } from './club-gift-price-adjustment.service';
import { ClubGiftTerminationService } from './club-gift-termination.service';
import { ClientContinuationController, EmployeeContinuationController } from './club-continuation.controller';
import { ClubContinuationService } from './club-continuation.service';
import { ClubGiftExecutionService } from './club-gift-execution.service';
import { ClientClubInvitationController, EmployeeClubInvitationController } from './club-member-invitation.controller';
import { ClubMemberInvitation, ClubMemberInvitationSchema, ClubMemberInvitationService } from './club-member-invitation.service';
import { ClubDispatchNoticeController } from './club-dispatch-notice.controller';
import {
  ClubDispatchNotice,
  ClubDispatchNoticeSchema,
} from './club-dispatch-notice.schema';
import { ClubDispatchNoticeService } from './club-dispatch-notice.service';
import { ClubDispatchPushController } from './club-dispatch-push.controller';
import {
  ClubDispatchPushDelivery,
  ClubDispatchPushDeliverySchema,
  ClubDispatchPushSubscription,
  ClubDispatchPushSubscriptionSchema,
} from './club-dispatch-push.schema';
import { ClubDispatchPushService } from './club-dispatch-push.service';
import { AdminAppNotificationController, ClientAppNotificationController, EmployeeAppNotificationController } from './app-notification.controller';
import { AppNotificationEvent, AppNotificationEventSchema } from './app-notification.schema';
import { AppNotificationService } from './app-notification.service';
import { ClubExecutionService } from './club-execution.service';
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
import { ClubPriceAdjustmentService } from './club-price-adjustment.service';
import { Club, ClubMember, ClubMemberSchema, ClubSchema } from './club.schema';
import { ClubSettlementCalculation, ClubSettlementCalculationSchema, ClubSettlementEvidence, ClubSettlementEvidenceSchema } from './club-settlement.schema';
import { ClubSettlementService } from './club-settlement.service';
import { ClubGiftSettlementService } from './club-gift-settlement.service';
import { ClubSettlementCorrectionController } from './club-settlement-correction.controller';
import { ClubSettlementCorrectionService } from './club-settlement-correction.service';
import { ClubSettlementEvidenceService } from './club-settlement-evidence.service';
import { ClubFinancialAdjustment, ClubFinancialAdjustmentSchema } from './club-financial-adjustment.schema';
import { AdminClubFinancialAdjustmentController, EmployeeClubFinancialAdjustmentController } from './club-financial-adjustment.controller';
import { ClubFinancialAdjustmentService } from './club-financial-adjustment.service';
import { ClubTerminationService } from './club-termination.service';
import { AdminClubServiceOrderController, ClientClubServiceOrderController, EmployeeClubServiceOrderController } from './club-service-order.controller';
import { ClubServiceOrder, ClubServiceOrderSchema } from './club-service-order.schema';
import { ClubServiceOrderService } from './club-service-order.service';
import { AdminClubWithdrawalController, EmployeeClubWithdrawalController } from './club-withdrawal.controller';
import { CLUB_WITHDRAWAL_EVENT_MODEL, ClubWithdrawalEventSchema } from './club-withdrawal.schema';
import { ClubWithdrawalService } from './club-withdrawal.service';
import { ClubWithdrawalStore } from './club-withdrawal.store';

@Module({
  imports: [
    EmployeeModule,
    RoleModule,
    UserDispatchActivationModule,
    AppSessionModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Club.name, schema: ClubSchema },
      { name: ClubMember.name, schema: ClubMemberSchema },
      { name: ClubOrder.name, schema: ClubOrderSchema },
      { name: ClubServiceOrder.name, schema: ClubServiceOrderSchema },
      { name: ClubPromotionCoupon.name, schema: ClubPromotionCouponSchema },
      { name: ClubMemberInvitation.name, schema: ClubMemberInvitationSchema },
      { name: DailyReport.name, schema: DailyReportSchema },
      { name: ClubDispatchNotice.name, schema: ClubDispatchNoticeSchema },
      { name: AppNotificationEvent.name, schema: AppNotificationEventSchema },
      { name: ClubDispatchPushSubscription.name, schema: ClubDispatchPushSubscriptionSchema },
      { name: ClubDispatchPushDelivery.name, schema: ClubDispatchPushDeliverySchema },
      { name: ClubSettlementCalculation.name, schema: ClubSettlementCalculationSchema },
      { name: ClubSettlementEvidence.name, schema: ClubSettlementEvidenceSchema },
      { name: ClubFinancialAdjustment.name, schema: ClubFinancialAdjustmentSchema },
      { name: CLUB_WITHDRAWAL_EVENT_MODEL, schema: ClubWithdrawalEventSchema },
    ]),
  ],
  controllers: [
    ClubDashboardController,
    AdminClubServiceOrderController,
    ClientClubServiceOrderController,
    EmployeeClubServiceOrderController,
    ClubSettlementCorrectionController,
    AdminClubFinancialAdjustmentController,
    EmployeeClubFinancialAdjustmentController,
    AdminClubWithdrawalController,
    EmployeeClubWithdrawalController,
    ClientGiftPriceAdjustmentController,
    EmployeeGiftPriceAdjustmentController,
    ClientContinuationController,
    EmployeeContinuationController,
    AdminClubController,
    ClubGiftDispatchController,
    ClientClubInvitationController,
    EmployeeClubInvitationController,
    EmployeeClubController,
    EmployeeClubOperationsController,
    EmployeeClubOrderController,
    ClubClaimController,
    ClubDeliveryController,
    ClubDispatchNoticeController,
    ClubDispatchPushController,
    AdminAppNotificationController,
    EmployeeAppNotificationController,
    ClientAppNotificationController,
    ClientClubController,
    ClientClubOrderController,
  ],
  providers: [
    ClubDashboardService,
    ClubServiceOrderService,
    ClubSettlementCorrectionService,
    ClubFinancialAdjustmentService,
    ClubWithdrawalService,
    ClubWithdrawalStore,
    ClubPromotionService,
    ClubContinuationService,
    ClubGiftSupervision,
    ClubGiftPriceAdjustmentService,
    ClubDirectoryService,
    ClubGiftDispatchService,
    ClubMemberInvitationService,
    ClubCustomerService,
    ClubOrderService,
    ClubClaimService,
    ClubDailyReportStore,
    ClubDeliveryService,
    ClubGiftDeliveryService,
    ClubPriceAdjustmentService,
    ClubTerminationService,
    ClubGiftTerminationService,
    ClubDispatchNoticeService,
    ClubDispatchPushService,
    AppNotificationService,
    ClubExecutionService,
    ClubGiftExecutionService,
    ClubSettlementService,
    ClubGiftSettlementService,
    ClubSettlementEvidenceService,
  ],
  exports: [ClubDirectoryService, ClubOrderService, AppNotificationService],
})
export class ClubModule {}
