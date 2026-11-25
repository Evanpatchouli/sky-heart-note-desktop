import { CLUB_ID } from './club.schema';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { giftBusinessDatePattern } from './club-gift-segment.dto';
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
import {
  AssignDispatcherDto,
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
  OrderCustomerQuery,
  OrderRequestDto,
  EmployeeClubOrderQuery,
} from './club-order.dto';
import { ClubDirectoryService } from './club-directory.service';
import { LinkGameAccountDto } from './club-execution.dto';
import { ClubGiftExecutionService } from './club-gift-execution.service';
import { ClubOrderService } from './club-order.service';
import { PersonalScheduleDto } from './club-personal-schedule.dto';
import {
  PublishOrderDto,
  RecordOrderReceiptDto,
  ReviewDispatchCommissionDto,
  UpdateOrderPricingDto,
} from './club-pricing.dto';

class FulfillmentQuery {
  @ValidateIf((_, value) => value !== undefined)
  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  through?: string;
}

class FulfillmentExceptionsQuery extends ClubOrderQuery {
  @Matches(giftBusinessDatePattern)
  @IsISO8601({ strict: true })
  through: string;
}

const orderValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@AppAccess('employee')
@UsePipes(orderValidation)
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

  @Get('order-customers')
  async orderCustomers(
    @AuthUser() user: SessionUser,
    @Query() query: OrderCustomerQuery,
  ) {
    return Resp.success(
      await this.orders.searchDirectOrderCustomers(CLUB_ID, user.id, query.q),
    );
  }
}

@AppAccess('employee')
@UsePipes(orderValidation)
@Controller('employee/club/orders')
export class EmployeeClubOrderController {
  constructor(
    private readonly orders: ClubOrderService,
    private readonly execution: ClubGiftExecutionService,
  ) {}

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

  @Post()
  async create(
    @AuthUser() user: SessionUser,
    @Body() input: CreateDirectOrderDto,
  ) {
    return Resp.success(
      await this.orders.createDirectOrder(CLUB_ID, user.id, input),
    );
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
    @AuthUser() user: SessionUser, @Query() query: FulfillmentExceptionsQuery,
  ) {
    return Resp.success(await this.orders.listFulfillmentExceptions(CLUB_ID, user.id, query));
  }

  @Get(':orderId/fulfillment')
  async fulfillment(
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Query() query: FulfillmentQuery,
  ) {
    return Resp.success(await this.orders.getDispatchFulfillment(CLUB_ID, user.id, orderId, query.through));
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
    @AuthUser() user: SessionUser, @Param('orderId') orderId: string,
    @Param('shareId') shareId: string, @Body() input: LinkGameAccountDto,
  ) {
    return Resp.success(await this.execution.linkAccount(CLUB_ID, user.id, orderId, shareId, input.personalAccountId));
  }

  @Post(':orderId/receipts')
  async recordOrderReceipt(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: RecordOrderReceiptDto,
  ) {
    return Resp.success(await this.orders.recordOrderReceipt(CLUB_ID, user.id, orderId, input));
  }

  @Patch(':orderId/dispatch-commission')
  async reviewDispatchCommission(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: ReviewDispatchCommissionDto,
  ) {
    return Resp.success(await this.orders.reviewDispatchCommission(CLUB_ID, user.id, orderId, input));
  }

  @Post(':orderId/publish')
  async commitDispatchAfterPayment(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: PublishOrderDto,
  ) {
    return Resp.success(await this.orders.commitDispatchAfterPayment(CLUB_ID, user.id, orderId, input));
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
}

@AppAccess('client')
@UsePipes(orderValidation)
@Controller('client/orders')
export class ClientClubOrderController {
  constructor(private readonly orders: ClubOrderService) {}

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
    return Resp.success(
      await this.orders.getCustomerOrder(CLUB_ID, user.id, orderId),
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
