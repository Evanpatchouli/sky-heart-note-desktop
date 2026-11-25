import { Body, Controller, Get, Param, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import {
  AssignServiceOrderDto, CreateClientServiceOrderDto, CreateEmployeeServiceOrderDto, DeliverServiceOrderDto,
  PublishServiceOrderDto, ServiceOrderQuery, ServiceOrderRequestDto, ServiceOrderUnitDto, StopServiceOrderDto,
} from './club-service-order.dto';
import { ClubServiceOrderService } from './club-service-order.service';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

class ServiceOrderController {
  constructor(protected readonly serviceOrders: ClubServiceOrderService) {}

  @Get()
  async list(@AuthUser() actor: SessionUser, @Query() query: ServiceOrderQuery) {
    return Resp.success(await this.serviceOrders.list(actor, query));
  }

  @Get(':id')
  async detail(@AuthUser() actor: SessionUser, @Param('id') id: string) {
    return Resp.success(await this.serviceOrders.detail(actor, id));
  }
}

@AppAccess('client')
@UsePipes(validation)
@Controller('client/club/service-orders')
export class ClientClubServiceOrderController extends ServiceOrderController {
  constructor(service: ClubServiceOrderService) { super(service); }

  @Post()
  async create(@AuthUser() actor: SessionUser, @Body() input: CreateClientServiceOrderDto) {
    return Resp.success(await this.serviceOrders.createClient(actor, input));
  }

  @Post(':id/accept')
  async accept(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: ServiceOrderUnitDto) {
    return Resp.success(await this.serviceOrders.accept(actor, id, input));
  }

  @Post(':id/stop')
  async stop(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: StopServiceOrderDto) {
    return Resp.success(await this.serviceOrders.stop(actor, id, input));
  }
}

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/club/service-orders')
export class EmployeeClubServiceOrderController extends ServiceOrderController {
  constructor(service: ClubServiceOrderService) { super(service); }

  @Post()
  async create(@AuthUser() actor: SessionUser, @Body() input: CreateEmployeeServiceOrderDto) {
    return Resp.success(await this.serviceOrders.createEmployee(actor, input));
  }

  @Post(':id/assign')
  async assign(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: AssignServiceOrderDto) {
    return Resp.success(await this.serviceOrders.assign(actor, id, input));
  }

  @Post(':id/publish')
  async publish(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: PublishServiceOrderDto) {
    return Resp.success(await this.serviceOrders.publish(actor, id, input));
  }

  @Post(':id/claim')
  async claim(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: ServiceOrderRequestDto) {
    return Resp.success(await this.serviceOrders.claim(actor, id, input));
  }

  @Post(':id/deliveries')
  async deliver(@AuthUser() actor: SessionUser, @Param('id') id: string, @Body() input: DeliverServiceOrderDto) {
    return Resp.success(await this.serviceOrders.deliver(actor, id, input));
  }
}

@AppAccess('admin')
@UsePipes(validation)
@Controller('admin/club/service-orders')
export class AdminClubServiceOrderController extends ServiceOrderController {
  constructor(service: ClubServiceOrderService) { super(service); }
}
