import { BadRequestException } from '@nestjs/common';

export function validateAccountCredentials(username: string, password: string) {
  const account = username.trim();
  if (account.length === 0 || account.length > 100 || password.length === 0 || password.length > 256)
    throw new BadRequestException('用户名或密码无效');
  return account;
}
