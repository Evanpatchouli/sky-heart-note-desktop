import { CLUB_ID } from './club.schema';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { appOrigins, type SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { PublishOrderDto } from './club-allocation.dto';
import {
  LinkGameAccountDto,
} from './club-execution.dto';
import { ClubExecutionService } from './club-execution.service';
import {
  AgreedReportDatesDto,
  AgreementDeadlineDto,
  DeliveryPeriodShiftDto,
  FulfillmentExceptionsQuery,
  FulfillmentQuery,
  FulfillmentReportsQuery,
  PersonalScheduleDto,
} from './club-fulfillment.dto';
import {
  AssignDispatcherDto,
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
  EmployeeClubOrderQuery,
  OrderCustomerQuery,
  OrderRequestDto,
} from './club-order.dto';
import { ClubOrderService } from './club-order.service';
import { ClubPriceAdjustmentService } from './club-price-adjustment.service';
import { ClubTerminationService } from './club-termination.service';
import { ClubGiftTerminationService } from './club-gift-termination.service';
import { RecordGiftTerminationChangeDto } from './club-gift-termination.dto';
import { terminationView } from './club-termination';
import {
  ConfirmTerminationTermsDto, RecordTerminationChangeDto, RecordTerminationRefundDto, RequestTerminationDto,
} from './club-termination.dto';
import {
  DecidePriceAdjustmentDto,
  ProposePriceAdjustmentDto,
  RecordPriceAdjustmentPaymentDto,
  RequestPriceReviewDto,
} from './club-price-adjustment.dto';
import { ClubDirectoryService } from './club-directory.service';
import { ClubSettlementService } from './club-settlement.service';
import { ClubGiftSettlementService } from './club-gift-settlement.service';
import { CloseGiftSettlementDto } from './club-settlement-close.dto';
import {
  RecordOrderReceiptDto,
  ReviewDispatchCommissionDto,
  UpdateOrderPricingDto,
} from './club-pricing.dto';

const orderValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@AppAccess('employee')
@Controller('employee/club')
export class EmployeeClubController {
  constructor(
    private readonly directory: ClubDirectoryService,
    private readonly orders: ClubOrderService,
  ) {}

  @Get('client-order-notices')
  async clientOrderNotices(@AuthUser() user: SessionUser) {
    return Resp.success(await this.orders.listClientOrderNotices(user.id));
  }

  @Get()
  async getClub(@AuthUser() user: SessionUser) {
    const club = await this.directory.getEmployeeClub(user.id);
    return Resp.success(club ? { ...club, orderUrl: new URL('/order', appOrigins().client).href } : null);
  }

  @Get('assignment-candidates')
  async assignmentCandidates(@AuthUser() user: SessionUser) {
    return Resp.success(await this.directory.listAssignmentCandidates(CLUB_ID, user.id));
  }

  @Get('dispatch-recipients')
  async dispatchRecipients(
    @AuthUser() user: SessionUser,
  ) {
    return Resp.success(
      await this.directory.listDispatchRecipients(CLUB_ID, user.id),
    );
  }

  @Get('order-customers')
  @UsePipes(orderValidation)
  async orderCustomers(
    @AuthUser() user: SessionUser,
    @Query() query: OrderCustomerQuery,
  ) {
    return Resp.success(await this.orders.searchDirectOrderCustomers(CLUB_ID, user.id, query.q));
  }
}

@AppAccess('employee')
@UsePipes(orderValidation)
@Controller('employee/club/orders')
export class EmployeeClubOrderController {
  constructor(
    private readonly orders: ClubOrderService,
    private readonly execution: ClubExecutionService,
    private readonly settlements: ClubSettlementService,
    private readonly adjustments: ClubPriceAdjustmentService,
    private readonly terminations: ClubTerminationService,
    private readonly giftTerminations: ClubGiftTerminationService,
    private readonly giftSettlements: ClubGiftSettlementService,
  ) {}

  @Post()
  async create(
    @AuthUser() user: SessionUser,
    @Body() input: CreateDirectOrderDto,
  ) {
    return Resp.success(
      await this.orders.createDirectOrder(CLUB_ID, user.id, input),
    );
  }

  @Get('pending-assignment')
  async listPendingAssignment(
    @AuthUser() user: SessionUser,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(await this.orders.listPendingAssignmentOrders(CLUB_ID, user.id, query));
  }

  @Post(':orderId/assign-dispatcher')
  async assignDispatcher(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: AssignDispatcherDto,
  ) {
    return Resp.success(await this.orders.assignPendingOrder(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/customer-activation')
  @Header('Cache-Control', 'no-store')
  async issueCustomerActivation(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.orders.issueCustomerActivation(CLUB_ID, user.id, orderId));
  }

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Query() query: EmployeeClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listEmployeeOrders(CLUB_ID, user.id, query),
    );
  }

  @Get('fulfillment-exceptions')
  async fulfillmentExceptions(
    @AuthUser() user: SessionUser,
    @Query() query: FulfillmentExceptionsQuery,
  ) {
    return Resp.success(
      await this.orders.listFulfillmentExceptions(CLUB_ID, user.id, query),
    );
  }

  @Get(':orderId/fulfillment')
  async fulfillment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Query() query: FulfillmentQuery,
  ) {
    return Resp.success(
      await this.orders.getDispatchFulfillment(CLUB_ID, user.id, orderId, query.through),
    );
  }

  @Get(':orderId/settlement')
  async settlement(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.settlements.personal(CLUB_ID, user.id, orderId));
  }

  @Post(':orderId/settlement/close')
  async close(@AuthUser() user: SessionUser, @Param('orderId') orderId: string, @Body() input: CloseGiftSettlementDto) {
    return Resp.success(await this.giftSettlements.close(CLUB_ID, user.id, orderId, input));
  }

  @Get(':orderId/fulfillment/reports')
  async fulfillmentReports(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Query() query: FulfillmentReportsQuery,
  ) {
    return Resp.success(
      await this.orders.getDispatchPeriodReports(CLUB_ID, user.id, orderId, query.through, query.after),
    );
  }

  @Post(':orderId/fulfillment/historical-price-preview')
  async previewDeliveryPrice(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: DeliveryPeriodShiftDto,
  ) {
    return Resp.success(await this.orders.previewDeliveryPrice(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/historical-price-adjustment')
  async proposePriceAdjustment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: ProposePriceAdjustmentDto,
  ) {
    return Resp.success(await this.adjustments.propose(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/termination/changes')
  async recordTerminationChange(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: unknown,
  ) {
    if (await this.giftTerminations.handles(CLUB_ID, orderId)) {
      const body: RecordGiftTerminationChangeDto = await orderValidation.transform(input, { type: 'body', metatype: RecordGiftTerminationChangeDto });
      return Resp.success(await this.giftTerminations.change(CLUB_ID, user.id, orderId, body));
    }
    const body: RecordTerminationChangeDto = await orderValidation.transform(input, { type: 'body', metatype: RecordTerminationChangeDto });
    return Resp.success(await this.terminations.change(CLUB_ID, user.id, orderId, body));
  }

  @Post(':orderId/termination/refunds')
  async recordTerminationRefund(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RecordTerminationRefundDto,
  ) {
    if (await this.giftTerminations.handles(CLUB_ID, orderId))
      return Resp.success(await this.giftTerminations.refund(CLUB_ID, user.id, orderId, input));
    return Resp.success(terminationView(await this.terminations.recordRefund(CLUB_ID, user.id, orderId, input)));
  }

  @Post(':orderId/historical-price-adjustment/payments')
  async recordPriceAdjustmentPayment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RecordPriceAdjustmentPaymentDto,
  ) {
    return Resp.success(await this.adjustments.recordPayment(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/historical-price-adjustment/reviews')
  async recordPriceReview(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RequestPriceReviewDto,
  ) {
    return Resp.success(await this.adjustments.requestReview(CLUB_ID, user.id, orderId, input));
  }

  @Patch(':orderId/agreed-deadline')
  async recordDeadline(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: AgreementDeadlineDto,
  ) {
    return Resp.success(
      await this.orders.recordAgreementDeadline(CLUB_ID, user.id, orderId, input),
    );
  }

  @Patch(':orderId/shares/:shareId/agreed-report-dates')
  async recordReportDates(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Param('shareId') shareId: string,
    @Body() input: AgreedReportDatesDto,
  ) {
    return Resp.success(
      await this.orders.recordShareReportDates(CLUB_ID, user.id, orderId, shareId, input),
    );
  }

  @Get(':orderId')
  async detail(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getEmployeeOrder(CLUB_ID, user.id, orderId),
    );
  }

  @Get(':orderId/assignment')
  async assignment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.orders.getPersonalAssignment(CLUB_ID, user.id, orderId));
  }

  @Patch(':orderId/personal-schedule')
  async recordPersonalSchedule(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: PersonalScheduleDto,
  ) {
    return Resp.success(await this.orders.recordPersonalSchedule(CLUB_ID, user.id, orderId, input));
  }

  @Get(':orderId/pricing')
  async getPricing(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getDispatchPreparation(CLUB_ID, user.id, orderId),
    );
  }

  @Post(':orderId/shares/:shareId/execution-accounts')
  async linkAccount(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Param('shareId') shareId: string,
    @Body() input: LinkGameAccountDto,
  ) {
    return Resp.success(
      await this.execution.linkAccount(
        CLUB_ID,
        user.id,
        orderId,
        shareId,
        input.personalAccountId,
      ),
    );
  }

  @Patch(':orderId/pricing')
  async updatePricing(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: UpdateOrderPricingDto,
  ) {
    return Resp.success(
      await this.orders.updateDispatchPricing(CLUB_ID, user.id, orderId, input),
    );
  }

  @Post(':orderId/receipts')
  async recordReceipt(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RecordOrderReceiptDto,
  ) {
    return Resp.success(
      await this.orders.recordOrderReceipt(CLUB_ID, user.id, orderId, input),
    );
  }

  @Patch(':orderId/dispatch-commission')
  async reviewCommission(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: ReviewDispatchCommissionDto,
  ) {
    return Resp.success(
      await this.orders.reviewDispatchCommission(
        CLUB_ID,
        user.id,
        orderId,
        input,
      ),
    );
  }

  @Post(':orderId/publish')
  async publish(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: PublishOrderDto,
  ) {
    return Resp.success(
      await this.orders.commitDispatchAfterPayment(
        CLUB_ID,
        user.id,
        orderId,
        input,
      ),
    );
  }
}

@AppAccess('client')
@Controller('client/club')
export class ClientClubController {
  constructor(private readonly directory: ClubDirectoryService, private readonly orders: ClubOrderService) {}

  @Get('order-options')
  async orderOptions(@AuthUser() user: SessionUser) {
    const [options, coupons] = await Promise.all([
      this.directory.getClientOrderOptions(CLUB_ID), this.orders.getCustomerCoupons(CLUB_ID, user.id),
    ]);
    return Resp.success({ ...options, ...(coupons.length ? { coupons } : {}) });
  }
}

@AppAccess('client')
@UsePipes(orderValidation)
@Controller('client/orders')
export class ClientClubOrderController {
  constructor(
    private readonly orders: ClubOrderService,
    private readonly adjustments: ClubPriceAdjustmentService,
    private readonly terminations: ClubTerminationService,
    private readonly giftTerminations: ClubGiftTerminationService,
    private readonly giftSettlements: ClubGiftSettlementService,
  ) {}

  @Post(':orderId/historical-price-adjustment/decision')
  async decidePriceAdjustment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: DecidePriceAdjustmentDto,
  ) {
    return Resp.success(await this.adjustments.decide(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/termination')
  async requestTermination(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RequestTerminationDto,
  ) {
    if (await this.giftTerminations.handles(CLUB_ID, orderId))
      return Resp.success(await this.giftTerminations.request(CLUB_ID, user.id, orderId, input));
    return Resp.success(await this.terminations.request(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/termination/confirmation')
  async confirmTerminationTerms(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: ConfirmTerminationTermsDto,
  ) {
    return Resp.success(await this.terminations.confirm(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/cancel-before-assignment')
  async cancelPendingOrder(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: OrderRequestDto,
  ) {
    return Resp.success(await this.orders.cancelPendingOrder(CLUB_ID, user.id, orderId, input.requestId));
  }

  @Post()
  async create(
    @AuthUser() user: SessionUser,
    @Body() input: CreateClientOrderDto,
  ) {
    return Resp.success(
      await this.orders.createClientOrder(CLUB_ID, user.id, input),
    );
  }

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listCustomerOrders(CLUB_ID, user.id, query),
    );
  }

  @Get(':orderId')
  async detail(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    const order = await this.orders.getCustomerOrder(CLUB_ID, user.id, orderId);
    const settlement = 'requestedGiftTimes' in order
      ? await this.giftSettlements.customer(CLUB_ID, user.id, orderId) : undefined;
    return Resp.success({ ...order, ...(settlement ? { settlement } : {}) });
  }
}
