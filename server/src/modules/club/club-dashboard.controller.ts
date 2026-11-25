import { Controller, Get, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import type { DashboardMetric } from '@sky-club/common';
import { IsIn, ValidateIf } from 'class-validator';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubDashboardService } from './club-dashboard.service';
import { ClubOrderQuery } from './club-order.dto';

export class ClubDashboardOrderQuery extends ClubOrderQuery {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['all', 'pending_dispatch', 'claimable', 'fulfilled', 'received', 'action_required', 'ready_to_close'] satisfies DashboardMetric[])
  metric?: DashboardMetric;
}

@AppAccess('admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Controller('admin/club/dashboard')
export class ClubDashboardController {
  constructor(private readonly dashboardService: ClubDashboardService) {}

  @Get()
  async dashboard(@AuthUser() actor: SessionUser) {
    return Resp.success(await this.dashboardService.dashboard(actor));
  }

  @Get('orders')
  async orders(@AuthUser() actor: SessionUser, @Query() query: ClubDashboardOrderQuery) {
    return Resp.success(await this.dashboardService.list(actor, query));
  }

  @Get('orders/:id')
  async order(@AuthUser() actor: SessionUser, @Param('id') id: string) {
    return Resp.success(await this.dashboardService.detail(actor, id));
  }
}
