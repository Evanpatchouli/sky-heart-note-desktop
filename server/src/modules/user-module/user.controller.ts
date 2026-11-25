import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Auth, AuthUser } from '@/auth/auth.decorator';
import { checkOrigin, parseApp, type SessionUser } from '@/auth/app-access';
import { AppSessionService } from '@/auth/app-session.service';
import Resp from '@/common/models/Resp';
import { EVENTS } from '@/constants/events';
import { OPTWay } from '@/constants/opt.constant';
import { HeaderAuthorization } from '@/decorators/header.decorator';
import { Ip } from '@/decorators/ip.decorator';
import UserLoginEvent from '@/events/user.login.event';
import UserLogoutEvent from '@/events/user.logout.event';
import CaptchaService from '../captcha-module/captcha.service';
import OPTService from '../opt-module/opt.service';
import { UserLoginService } from './user.service.login';
import { UserDispatchActivationService } from './user-dispatch-activation.service';

function field(value: unknown, name: string) {
  if (typeof value !== 'string' || !value || value.length > 512)
    throw new BadRequestException('无效的参数 ' + name);
  return value;
}

@Controller('user')
export class UserController {
  constructor(
    private readonly loginService: UserLoginService,
    private readonly sessions: AppSessionService,
    private readonly captcha: CaptchaService,
    private readonly otp: OPTService,
    private readonly events: EventEmitter2,
    private readonly activation: UserDispatchActivationService,
  ) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() form: Record<string, unknown>,
    @Query('type') type: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const app = parseApp(form?.app);
    if (!req.is('application/json'))
      throw new BadRequestException('需要 JSON 请求');
    checkOrigin(req, app, type === 'shared');
    let id: string;
    switch (type) {
      case 'account': {
        if (
          !(await this.captcha.verify(
            req,
            app,
            'login',
            field(form.captcha, 'captcha'),
          ))
        ) {
          throw new BadRequestException('验证码错误');
        }
        id = await this.loginService.account(
          field(form.username, 'username'),
          field(form.password, 'password'),
        );
        break;
      }
      case 'email':
      case 'phone': {
        const value = field(form[type], type);
        if (
          !this.otp.verify(
            value,
            field(form.code, 'code'),
            type === 'email' ? OPTWay.EMAIL_LOGIN : OPTWay.PHONE_LOGIN,
          )
        ) {
          throw new BadRequestException('验证码错误');
        }
        id = await this.loginService.verifiedContact(type, value);
        break;
      }
      case 'shared':
        id = await this.sessions.borrow(
          req,
          parseApp(form.sourceApp),
          app,
          field(form.sourceUserId, 'sourceUserId'),
        );
        break;
      default:
        throw new BadRequestException('不支持的登录方式');
    }
    const result = await this.sessions.issue(req, res, id, app);
    this.events.emit(
      EVENTS.USER_LOGIN,
      new UserLoginEvent(id, ip, Date.now(), type),
    );
    return Resp.success(result);
  }

  @Get('login/candidates')
  @Header('Cache-Control', 'no-store')
  async candidates(@Req() req: Request, @Query('app') target: string) {
    const app = parseApp(target);
    checkOrigin(req, app, true);
    return Resp.success(await this.sessions.candidates(req, app));
  }

  @Auth()
  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(
    @Query('app') target: string,
    @AuthUser() user: SessionUser,
    @HeaderAuthorization() token: string,
  ) {
    if (parseApp(target) !== user.app)
      throw new ForbiddenException('登录授权与应用不匹配');
    return Resp.success({ ...user, token });
  }

  @Auth()
  @Post('logout')
  async logout(
    @AuthUser() user: SessionUser,
    @HeaderAuthorization() token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.logout(req, res, token, user.app);
    this.events.emit(EVENTS.USER_LOGOUT, new UserLogoutEvent(user.id));
    return Resp.success();
  }

  @Post('register')
  async register(
    @Query('type') type: string,
    @Body() form: Record<string, unknown>,
    @Req() req: Request,
  ) {
    // Self-registration creates only a common account. All sign-ins go through /user/login.
    checkOrigin(req, 'client');
    if (type !== 'account' || parseApp(form?.app) !== 'client')
      throw new BadRequestException('仅客户端开放账号注册');
    if (
      !req.is('application/json') ||
      !(await this.captcha.verify(
        req,
        'client',
        'register',
        field(form.captcha, 'captcha'),
      ))
    ) {
      throw new BadRequestException('验证码错误');
    }
    const id = await this.loginService.register(
      field(form.username, 'username'),
      field(form.password, 'password'),
    );
    return Resp.success({ id });
  }

  @Post('activate-dispatch-customer')
  @Header('Cache-Control', 'no-store')
  async activateDispatchCustomer(@Body() form: Record<string, unknown>, @Req() req: Request) {
    checkOrigin(req, 'client', true);
    if (!req.is('application/json')) throw new BadRequestException('需要 JSON 请求');
    await this.activation.activate(
      field(form?.token, 'token'), field(form?.username, 'username'), field(form?.password, 'password'),
    );
    return Resp.success();
  }
}
