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
import { LinkGameAccountDto, RecordAccountRelationshipDto } from './club-execution.dto';
import { ClubGiftExecutionService } from './club-gift-execution.service';
import { ClubOrderService } from './club-order.service';
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
@Controller('employee/clubs')
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
  async list(@AuthUser() user: SessionUser) {
    const clubs = await this.directory.listEmployeeClubs(user.id);
    const clientOrigin = appOrigins().client;
    return Resp.success(clubs.map((club) => {
      const orderUrl = new URL('/order', clientOrigin);
      orderUrl.searchParams.set('club', club.id);
      return { ...club, orderUrl: orderUrl.href };
    }));
  }

  @Get(':clubId/assignment-candidates')
  async assignmentCandidates(@AuthUser() user: SessionUser, @Param('clubId') clubId: string) {
    return Resp.success(await this.directory.listAssignmentCandidates(clubId, user.id));
  }

  @Get(':clubId/order-customers')
  async orderCustomers(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: OrderCustomerQuery,
  ) {
    return Resp.success(
      await this.orders.searchDirectOrderCustomers(clubId, user.id, query.q),
    );
  }
}

@AppAccess('employee')
@UsePipes(orderValidation)
@Controller('employee/clubs/:clubId/orders')
export class EmployeeClubOrderController {
  constructor(
    private readonly orders: ClubOrderService,
    private readonly execution: ClubGiftExecutionService,
  ) {}

  @Get('pending-assignment')
  async listPendingAssignment(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(await this.orders.listPendingAssignmentOrders(clubId, user.id, query));
  }

  @Post(':orderId/assign-dispatcher')
  async assignDispatcher(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: AssignDispatcherDto,
  ) {
    return Resp.success(await this.orders.assignPendingOrder(clubId, user.id, orderId, input));
  }

  @Post(':orderId/customer-activation')
  @Header('Cache-Control', 'no-store')
  async issueCustomerActivation(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.orders.issueCustomerActivation(clubId, user.id, orderId));
  }

  @Post()
  async create(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Body() input: CreateDirectOrderDto,
  ) {
    return Resp.success(
      await this.orders.createDirectOrder(clubId, user.id, input),
    );
  }

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: EmployeeClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listEmployeeOrders(clubId, user.id, query),
    );
  }

  @Get('fulfillment-exceptions')
  async fulfillmentExceptions(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Query() query: FulfillmentExceptionsQuery,
  ) {
    return Resp.success(await this.orders.listFulfillmentExceptions(clubId, user.id, query));
  }

  @Get(':orderId/fulfillment')
  async fulfillment(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Query() query: FulfillmentQuery,
  ) {
    return Resp.success(await this.orders.getDispatchFulfillment(clubId, user.id, orderId, query.through));
  }

  @Get(':orderId')
  async detail(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getEmployeeOrder(clubId, user.id, orderId),
    );
  }

  @Get(':orderId/pricing')
  async getPricing(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getDispatchPreparation(clubId, user.id, orderId),
    );
  }

  @Post(':orderId/shares/:shareId/execution-accounts')
  async linkAccount(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('shareId') shareId: string, @Body() input: LinkGameAccountDto,
  ) {
    return Resp.success(await this.execution.linkAccount(clubId, user.id, orderId, shareId, input.personalAccountId));
  }

  @Post(':orderId/shares/:shareId/execution-accounts/:accountId/relationship')
  async recordRelationship(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('shareId') shareId: string, @Param('accountId') accountId: string, @Body() input: RecordAccountRelationshipDto,
  ) {
    return Resp.success(await this.execution.recordRelationship(
      clubId, user.id, orderId, shareId, accountId, input.relationship, input.occurredAt,
    ));
  }

  @Post(':orderId/receipts')
  async recordOrderReceipt(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: RecordOrderReceiptDto,
  ) {
    return Resp.success(await this.orders.recordOrderReceipt(clubId, user.id, orderId, input));
  }

  @Patch(':orderId/dispatch-commission')
  async reviewDispatchCommission(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: ReviewDispatchCommissionDto,
  ) {
    return Resp.success(await this.orders.reviewDispatchCommission(clubId, user.id, orderId, input));
  }

  @Post(':orderId/publish')
  async commitDispatchAfterPayment(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: PublishOrderDto,
  ) {
    return Resp.success(await this.orders.commitDispatchAfterPayment(clubId, user.id, orderId, input));
  }

  @Patch(':orderId/pricing')
  async updatePricing(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: UpdateOrderPricingDto,
  ) {
    return Resp.success(
      await this.orders.updateDispatchPricing(clubId, user.id, orderId, input),
    );
  }
}

@AppAccess('client')
@UsePipes(orderValidation)
@Controller('client/clubs/:clubId/orders')
export class ClientClubOrderController {
  constructor(private readonly orders: ClubOrderService) {}

  @Post(':orderId/cancel-before-assignment')
  async cancelPendingOrder(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
    @Body() input: OrderRequestDto,
  ) {
    return Resp.success(await this.orders.cancelPendingOrder(clubId, user.id, orderId, input.requestId));
  }

  @Post()
  async create(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Body() input: CreateClientOrderDto,
  ) {
    return Resp.success(
      await this.orders.createClientOrder(clubId, user.id, input),
    );
  }

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listCustomerOrders(clubId, user.id, query),
    );
  }

  @Get(':orderId')
  async detail(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getCustomerOrder(clubId, user.id, orderId),
    );
  }
}

@AppAccess('client')
@Controller('client/clubs')
export class ClientClubController {
  constructor(private readonly directory: ClubDirectoryService, private readonly orders: ClubOrderService) {}

  @Get(':clubId/order-options')
  async orderOptions(@Param('clubId') clubId: string, @AuthUser() user: SessionUser) {
    const [options, coupons] = await Promise.all([
      this.directory.getClientOrderOptions(clubId), this.orders.getCustomerCoupons(clubId, user.id),
    ]);
    return Resp.success({ ...options, ...(coupons.length ? { coupons } : {}) });
  }
}

@AppAccess('client')
@UsePipes(orderValidation)
@Controller('client/orders')
export class ClientOwnOrdersController {
  constructor(private readonly orders: ClubOrderService) {}

  @Get()
  async list(@AuthUser() user: SessionUser, @Query() query: ClubOrderQuery) {
    return Resp.success(await this.orders.listMyCustomerOrders(user.id, query));
  }
}
