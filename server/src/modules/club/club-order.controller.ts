import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import {
  ClubOrderQuery,
  CreateClientOrderDto,
  CreateDirectOrderDto,
  OrderCustomerQuery,
} from './club-order.dto';
import { ClubDirectoryService } from './club-directory.service';
import { ClubOrderService } from './club-order.service';

const orderValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@AppAccess('employee')
@UsePipes(orderValidation)
@Controller('employee/clubs')
export class EmployeeClubController {
  constructor(private readonly directory: ClubDirectoryService, private readonly orders: ClubOrderService) {}

  @Get()
  async list(@AuthUser() user: SessionUser) {
    return Resp.success(await this.directory.listEmployeeClubs(user.id));
  }

  @Get(':clubId/order-customers')
  async orderCustomers(
    @AuthUser() user: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: OrderCustomerQuery,
  ) {
    return Resp.success(await this.orders.searchDirectOrderCustomers(clubId, user.id, query.q));
  }
}

@AppAccess('employee')
@UsePipes(orderValidation)
@Controller('employee/clubs/:clubId/orders')
export class EmployeeClubOrderController {
  constructor(private readonly orders: ClubOrderService) {}

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
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listEmployeeOrders(clubId, user.id, query),
    );
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
}

@AppAccess('client')
@UsePipes(orderValidation)
@Controller('client/clubs/:clubId/orders')
export class ClientClubOrderController {
  constructor(private readonly orders: ClubOrderService) {}

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
@UsePipes(orderValidation)
@Controller('client/orders')
export class ClientOwnOrdersController {
  constructor(private readonly orders: ClubOrderService) {}

  @Get()
  async list(@AuthUser() user: SessionUser, @Query() query: ClubOrderQuery) {
    return Resp.success(await this.orders.listMyCustomerOrders(user.id, query));
  }
}
