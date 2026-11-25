import { AppAccess } from '@/auth/auth.decorator';
import { Controller, Get, Inject, Query, Req, Param, Put, Delete, Body } from '@nestjs/common';
import Resp from '../../common/models/Resp';
import { IsArray, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { RoleService } from '../role-module/role.service';
import { ToBoolean, ToNumber } from '../../decorators/transform.decorator';
import { Tag } from '../../decorators/tag.decorator';
import { Todo } from '../../decorators/todo.decorator';
import { UserManageService } from '../user-module/user.service.manage';
import { PaginatedResult, USER_ID_PATTERN } from '@sky-club/common';
import { User } from '../user-module/user.schema';
import { vofy } from '@/utils/vofy';

class QueryUserPageParams {
  @IsNotEmpty()
  @ToNumber()
  page: number;
  @IsNotEmpty()
  @ToNumber()
  size: number;

  @IsOptional()
  @Matches(USER_ID_PATTERN, { message: '用户 ID 必须由四位数字或大写字母组成' })
  id?: string;
}

class UpdatePhoneDto {
  @IsNotEmpty()
  @IsString()
  phone: string;
}

class UpdateWchatDto {
  @IsNotEmpty()
  @IsString()
  openid: string;
}

class UpdateEmailDto {
  @IsNotEmpty()
  @IsString()
  email: string;
}

class UpdateRolesDto {
  @IsNotEmpty({ each: true })
  @IsArray()
  roleIds: string[];
}

@AppAccess('admin')
@Tag('用户管理')
@Controller('admin/user-manage')
export class UserManageController {
  constructor(
    @Inject()
    private userManageService: UserManageService,
    @Inject()
    private roleService: RoleService,
  ) { }

  @Get()
  @Tag('分页查询用户')
  async queryUserPage(
    @Query() params: QueryUserPageParams,
  ): Promise<Resp<PaginatedResult<User>>> {
    const { list, ...result } = await this.userManageService.findPage(
      params.page,
      params.size,
      params.id === undefined ? undefined : { _id: params.id },
    );
    return Resp.success({
      // list: list.map((i) => vofy(i)),
      list,
      ...result,
    });
  }

  @Get(':id')
  @Tag('获取用户详情')
  async getUserDetail(@Param('id') id: string): Promise<Resp<User>> {
    const user = await this.userManageService.getUserDetail(id);
    return Resp.success(user);
  }

  @Put(':id/status')
  @Tag('切换用户状态')
  async toggleUserStatus(@Param('id') id: string): Promise<Resp<void>> {
    await this.userManageService.toggleUserStatus(id);
    return Resp.success();
  }

  @Put(':id/phone')
  @Tag('更新用户手机号')
  async updatePhone(@Param('id') id: string, @Body() dto: UpdatePhoneDto): Promise<Resp<void>> {
    await this.userManageService.updatePhone(id, dto.phone);
    return Resp.success();
  }

  @Put(':id/wechat')
  @Tag('更新用户微信')
  async updateWchat(@Param('id') id: string, @Body() dto: UpdateWchatDto): Promise<Resp<void>> {
    await this.userManageService.updateWchat(id, dto.openid);
    return Resp.success();
  }

  @Put(':id/email')
  @Tag('更新用户邮箱')
  async updateEmail(@Param('id') id: string, @Body() dto: UpdateEmailDto): Promise<Resp<void>> {
    await this.userManageService.updateEmail(id, dto.email);
    return Resp.success();
  }

  @Put(':id/roles')
  @Tag('更新用户角色')
  async updateRoles(@Param('id') id: string, @Body() dto: UpdateRolesDto): Promise<Resp<void>> {
    await this.userManageService.updateRoles(id, dto.roleIds);
    return Resp.success();
  }

  @Put(':id/reset-password')
  @Tag('重置用户密码')
  async resetPassword(@Param('id') id: string): Promise<Resp<{ password: string }>> {
    const password = await this.userManageService.resetPassword(id);
    return Resp.success({ password });
  }

  @Delete(':id')
  @Tag('删除用户')
  async deleteUser(@Param('id') id: string): Promise<Resp<void>> {
    await this.userManageService.deleteUser(id);
    return Resp.success();
  }

  @Put(':id/restore')
  @Tag('恢复用户')
  async restoreUser(@Param('id') id: string): Promise<Resp<void>> {
    await this.userManageService.restoreUser(id);
    return Resp.success();
  }
}
