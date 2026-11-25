import cache from '@/cache';
import { OPTWay } from '@/constants/opt.constant';
import { ValuesOf } from '@sky-club/common';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createOPT } from './opt.util';
import EmailService from '../email-module/email.service';
import { isEmail } from 'class-validator';

@Injectable()
export default class OPTService {
  constructor(
    @Inject() private emailService: EmailService,
  ) {}

  verify(
    key: string,
    code: string,
    way: ValuesOf<typeof OPTWay>,
  ) {
    const cacheKey = `${way}::${key}`;
    const isValid = typeof code === 'string' && code.length === 6 && code === cache.get(cacheKey);
    cache.delete(cacheKey);
    return isValid;
  }

  generatePhoneLoginOPT(_phone: string) {
    throw new ServiceUnavailableException('当前未配置短信服务');
  }

  async generateEmailLoginOPT(email: string) {
    if (!isEmail(email)) throw new BadRequestException('邮箱地址无效');
    const opt = createOPT('30m');
    await this.emailService.sendOptEmail(email, opt.code, OPTWay.EMAIL_LOGIN);
    cache.set(OPTWay.EMAIL_LOGIN + '::' + email, opt.code, opt.expiry);
  }
}
