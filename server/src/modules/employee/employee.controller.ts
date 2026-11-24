import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AppAccess, AuthUser } from '../../auth/auth.decorator';
import type { SessionUser } from '../../auth/app-access';
import Resp from '../../common/models/Resp';
import { EmployeeService } from './employee.service';

@AppAccess('employee')
@Controller('employee')
export class EmployeeController {
  constructor(private readonly service: EmployeeService) {}

  @Get('workspace')
  workspace() {
    return Resp.success({ appDir: '/api/employee/', bookings: 'bookings', accounts: 'songxinhao', settings: 'settings' });
  }

  @Get('settings')
  settings(@AuthUser() user: SessionUser) {
    return Resp.success(this.service.settings(user.id));
  }

  @Put('settings/:key')
  setSetting(@AuthUser() user: SessionUser, @Param('key') key: string, @Body('value') value: unknown) {
    return Resp.success(this.service.setSetting(user.id, key, value));
  }

  @Delete('settings/:key')
  deleteSetting(@AuthUser() user: SessionUser, @Param('key') key: string) {
    return Resp.success(this.service.deleteSetting(user.id, key));
  }

  @Get('bookings')
  bookings(@AuthUser() user: SessionUser) {
    return Resp.success(this.service.list(user.id, 'booking'));
  }

  @Post('bookings')
  createBooking(@AuthUser() user: SessionUser, @Body() body: unknown) {
    return Resp.success(this.service.create(user.id, 'booking', body));
  }

  @Patch('bookings/:id')
  updateBooking(@AuthUser() user: SessionUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return Resp.success(this.service.update(user.id, 'booking', id, body));
  }

  @Delete('bookings/:id')
  deleteBooking(@AuthUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return Resp.success(this.service.remove(user.id, 'booking', id));
  }

  @Get('songxinhao')
  accounts(@AuthUser() user: SessionUser) {
    return Resp.success(this.service.list(user.id, 'songxinhao'));
  }

  @Post('songxinhao')
  createAccount(@AuthUser() user: SessionUser, @Body() body: unknown) {
    return Resp.success(this.service.create(user.id, 'songxinhao', body));
  }

  @Patch('songxinhao/:id')
  updateAccount(@AuthUser() user: SessionUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return Resp.success(this.service.update(user.id, 'songxinhao', id, body));
  }

  @Delete('songxinhao/:id')
  deleteAccount(@AuthUser() user: SessionUser, @Param('id', ParseIntPipe) id: number) {
    return Resp.success(this.service.remove(user.id, 'songxinhao', id));
  }

  @Get('share')
  sharedState(@AuthUser() user: SessionUser) {
    return Resp.success(this.service.sharedState(user.id));
  }

  @Post('share')
  writeShared(@AuthUser() user: SessionUser, @Body() body: unknown) {
    return Resp.success(this.service.writeShared(user.id, body));
  }

  @Delete('share')
  removeShared(@AuthUser() user: SessionUser, @Query('key') key?: string) {
    return Resp.success(this.service.removeShared(user.id, key));
  }
}
