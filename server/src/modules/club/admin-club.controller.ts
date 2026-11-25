import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubDirectoryService } from './club-directory.service';
import { ClubOrderQuery } from './club-order.dto';
import { ClubOrderService } from './club-order.service';
import { UpdateCommissionRuleDto } from './club-pricing.dto';

class UpdateDispatcherDto {
  @IsBoolean()
  dispatcher: boolean;
}

@AppAccess('admin')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('admin/clubs')
export class AdminClubController {
  constructor(
    private readonly directory: ClubDirectoryService,
    private readonly orders: ClubOrderService,
  ) {}

  @Get()
  async list(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.directory.listAdminClubs(actor));
  }

  @Get(':clubId/commission-rule')
  async getCommissionRule(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
  ) {
    return Resp.success(
      await this.directory.getAdminCommissionRule(clubId, actor),
    );
  }

  @Patch(':clubId/commission-rule')
  async updateCommissionRule(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
    @Body() input: UpdateCommissionRuleDto,
  ) {
    return Resp.success(
      await this.directory.updateCommissionRule(clubId, actor, input),
    );
  }

  @Get(':clubId/dispatch-pricing')
  async listDispatchPricing(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listAdminDispatchPricing(clubId, actor, query),
    );
  }

  @Get(':clubId/orders')
  async listOrders(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listAdminOrders(clubId, actor, query),
    );
  }

  @Get(':clubId/orders/:orderId')
  async getOrder(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getAdminOrder(clubId, actor, orderId),
    );
  }

  @Get(':clubId/members')
  async listMembers(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
  ) {
    return Resp.success(await this.directory.listAdminMembers(clubId, actor));
  }

  @Patch(':clubId/members/:userId/dispatcher')
  async setDispatcher(
    @AuthUser() actor: SessionUser,
    @Param('clubId') clubId: string,
    @Param('userId') userId: string,
    @Body() input: UpdateDispatcherDto,
  ) {
    return Resp.success(
      await this.directory.setMemberDispatcher(
        clubId,
        actor,
        userId,
        input.dispatcher,
      ),
    );
  }
}
