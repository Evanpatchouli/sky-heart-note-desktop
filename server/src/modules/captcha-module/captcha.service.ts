import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import type { Request, Response } from 'express';
import svgCaptcha from 'svg-captcha';
import type { WebApp } from '@/auth/app-access';
import AppConfig from '@/app.config';
import { CaptchaChallenge } from './captcha.schema';

type Purpose = 'login' | 'register';
const expiresIn = 5 * 60 * 1000;
const name = (app: WebApp, purpose: Purpose) =>
  'sky_captcha_' + app + '_' + purpose;
function answerHash(
  challenge: string,
  app: WebApp,
  purpose: Purpose,
  text: string,
) {
  return createHmac('sha256', AppConfig.Session.secret)
    .update([challenge, app, purpose, text.toLowerCase()].join(':'))
    .digest('hex');
}

@Injectable()
export default class CaptchaService {
  constructor(
    @InjectModel(CaptchaChallenge.name)
    private readonly challenges: Model<CaptchaChallenge>,
  ) {}

  async generate(res: Response, app: WebApp, purpose: Purpose) {
    const { text, data } = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1i',
      noise: 2,
      color: true,
      background: '#fff',
    });
    const challenge = randomBytes(24).toString('base64url');
    await this.challenges.create({
      challenge,
      answer: answerHash(challenge, app, purpose, text),
      expiresAt: new Date(Date.now() + expiresIn),
    });
    res.cookie(name(app, purpose), challenge, {
      path: '/api/user',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: expiresIn,
      secure:
        process.env.NODE_ENV === 'production' ||
        process.env.APP_ENV === 'production',
    });
    return Buffer.from(data).toString('base64');
  }

  async verify(req: Request, app: WebApp, purpose: Purpose, text: string) {
    const prefix = name(app, purpose) + '=';
    const challenge = req.headers.cookie
      ?.split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(prefix))
      ?.slice(prefix.length);
    if (!challenge || !/^[\w-]{32}$/.test(challenge)) return false;
    const record = await this.challenges.findOneAndDelete({
      challenge,
      expiresAt: { $gt: new Date() },
    });
    return record?.answer === answerHash(challenge, app, purpose, text);
  }
}
