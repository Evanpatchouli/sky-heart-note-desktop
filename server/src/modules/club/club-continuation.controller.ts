import { Body, Controller, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { SessionUser } from '../../auth/app-access';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import Resp from '../../common/models/Resp';
import { ClubContinuationService } from './club-continuation.service';
import { AddContinuationQuoteDto, ContinuationActionDto, ContinuationWindowDto, RecordContinuationReceiptDto, RequestContinuationDto } from './club-pricing.dto';

const validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@AppAccess('employee')
@UsePipes(validation)
@Controller('employee/clubs/:clubId/orders/:orderId/continuation-quotes')
export class EmployeeContinuationController {
  constructor(private readonly continuations: ClubContinuationService) {}

  @Post()
  async quote(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Body() input: AddContinuationQuoteDto,
  ) {
    return Resp.success(await this.continuations.quote(clubId, user.id, orderId, input));
  }

  @Patch(':quoteId/window')
  async window(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: ContinuationWindowDto,
  ) {
    return Resp.success(await this.continuations.window(clubId, user.id, orderId, quoteId, input));
  }

  @Post(':quoteId/receipt')
  async receipt(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: RecordContinuationReceiptDto,
  ) {
    return Resp.success(await this.continuations.receive(clubId, user.id, orderId, quoteId, input));
  }
}

@AppAccess('client')
@UsePipes(validation)
@Controller('client/clubs/:clubId/orders/:orderId')
export class ClientContinuationController {
  constructor(private readonly continuations: ClubContinuationService) {}

  @Post('continuation-requests')
  async request(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Body() input: RequestContinuationDto,
  ) {
    return Resp.success(await this.continuations.request(clubId, user.id, orderId, input));
  }

  @Post('continuation-quotes/:quoteId/acceptance')
  async accept(
    @AuthUser() user: SessionUser, @Param('clubId') clubId: string, @Param('orderId') orderId: string,
    @Param('quoteId') quoteId: string, @Body() input: ContinuationActionDto,
  ) {
    return Resp.success(await this.continuations.accept(clubId, user.id, orderId, quoteId, input));
  }
}
