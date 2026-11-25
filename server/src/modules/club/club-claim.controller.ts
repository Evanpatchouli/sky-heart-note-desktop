import { CLUB_ID } from './club.schema';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClaimOrderDto } from './club-allocation.dto';
import { ClubClaimService } from './club-claim.service';
import { ClaimBoardQuery } from './club-order.dto';

@AppAccess('employee')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('employee/club/claim-board')
export class ClubClaimController {
  constructor(private readonly claims: ClubClaimService) {}

  @Get()
  async list(
    @AuthUser() user: SessionUser,
    @Query() query: ClaimBoardQuery,
  ) {
    return Resp.success(await this.claims.list(CLUB_ID, user.id, query));
  }

  @Get(':orderId')
  async detail(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
  ) {
    return Resp.success(await this.claims.detail(CLUB_ID, user.id, orderId));
  }

  @Post(':orderId/claims')
  async claim(
    @AuthUser() user: SessionUser,
    @Param('orderId') orderId: string,
    @Body() input: ClaimOrderDto,
  ) {
    return Resp.success(
      await this.claims.claim(CLUB_ID, user.id, orderId, input),
    );
  }
}
