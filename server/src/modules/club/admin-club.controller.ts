import { CLUB_ID } from './club.schema';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { IssueClubCouponDto, UpdateClubPromotionDto } from './club-promotion.dto';
import { ClubPromotionService } from './club-promotion.service';
import { ClubSettlementService } from './club-settlement.service';

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
@Controller('admin/club')
export class AdminClubController {
  constructor(
    private readonly directory: ClubDirectoryService,
    private readonly orders: ClubOrderService,
    private readonly promotions: ClubPromotionService,
    private readonly settlements: ClubSettlementService,
  ) {}

  @Get()
  async list(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.directory.getAdminClub(actor));
  }

  @Get('commission-rule')
  async getCommissionRule(
    @AuthUser() actor: SessionUser,
  ) {
    return Resp.success(
      await this.directory.getCommissionRule(CLUB_ID, actor),
    );
  }

  @Get('promotions')
  async getPromotions(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.promotions.readAdminPolicy(CLUB_ID, actor));
  }

  @Patch('promotions')
  async updatePromotions(@AuthUser() actor: SessionUser, @Body() input: UpdateClubPromotionDto) {
    return Resp.success(await this.promotions.updatePolicy(CLUB_ID, actor, input));
  }

  @Post('promotions/coupons')
  async issueCoupon(@AuthUser() actor: SessionUser, @Body() input: IssueClubCouponDto) {
    return Resp.success(await this.promotions.issueCoupon(CLUB_ID, actor, input));
  }

  @Patch('commission-rule')
  async updateCommissionRule(
    @AuthUser() actor: SessionUser,
    @Body() input: UpdateCommissionRuleDto,
  ) {
    return Resp.success(
      await this.directory.updateCommissionRule(CLUB_ID, actor, input),
    );
  }

  @Get('dispatch-pricing')
  async listDispatchPricing(
    @AuthUser() actor: SessionUser,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listAdminDispatchPricing(CLUB_ID, actor, query),
    );
  }

  @Get('orders')
  async listOrders(
    @AuthUser() actor: SessionUser,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(
      await this.orders.listAdminOrders(CLUB_ID, actor, query),
    );
  }

  @Get('settlements')
  async listSettlements(
    @AuthUser() actor: SessionUser,
    @Query() query: ClubOrderQuery,
  ) {
    return Resp.success(await this.settlements.adminList(CLUB_ID, actor, query));
  }

  @Get('orders/:orderId/settlement')
  async settlement(
    @AuthUser() actor: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.settlements.adminDetail(CLUB_ID, actor, orderId));
  }

  @Get('orders/:orderId/settlement/calculations/:calculationId')
  async calculation(
    @AuthUser() actor: SessionUser,
    @Param('orderId') orderId: string,
    @Param('calculationId') calculationId: string,
  ) {
    return Resp.success(await this.settlements.historical(CLUB_ID, actor, orderId, calculationId));
  }

  @Get('orders/:orderId')
  async getOrder(
    @AuthUser() actor: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(
      await this.orders.getAdminOrder(CLUB_ID, actor, orderId),
    );
  }

  @Get('members')
  async listMembers(
    @AuthUser() actor: SessionUser,
  ) {
    return Resp.success(await this.directory.listMembers(CLUB_ID, actor));
  }

  @Patch('members/:userId/dispatcher')
  async setDispatcher(
    @AuthUser() actor: SessionUser,
    @Param('userId') userId: string,
    @Body() input: UpdateDispatcherDto,
  ) {
    return Resp.success(
      await this.directory.setMemberDispatcher(
        CLUB_ID,
        actor,
        userId,
        input.dispatcher,
      ),
    );
  }
}
