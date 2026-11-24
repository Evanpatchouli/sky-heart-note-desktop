import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { checkOrigin, parseApp } from '@/auth/app-access';
import Resp from '@/common/models/Resp';
import CaptchaService from './captcha.service';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captcha: CaptchaService) {}

  @Get(':purpose')
  @Header('Cache-Control', 'no-store')
  async generate(
    @Param('purpose') purpose: string,
    @Query('app') target: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const app = parseApp(target);
    checkOrigin(req, app);
    if (purpose !== 'login' && !(purpose === 'register' && app === 'client')) {
      throw new BadRequestException('无效的验证码用途');
    }
    return Resp.success(await this.captcha.generate(res, app, purpose));
  }
}
