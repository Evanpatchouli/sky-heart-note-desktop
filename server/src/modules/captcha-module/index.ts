import { Module } from '@nestjs/common';
import { CaptchaController } from './captcha.controller';
import CaptchaService from './captcha.service';
import { MongooseModule } from '@nestjs/mongoose';
import { CaptchaChallenge, CaptchaSchema } from './captcha.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CaptchaChallenge.name, schema: CaptchaSchema },
    ]),
  ],
  controllers: [CaptchaController],
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
