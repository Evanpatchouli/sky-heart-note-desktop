import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('site')
  getSite() {
    return { name: '送心手记' };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
