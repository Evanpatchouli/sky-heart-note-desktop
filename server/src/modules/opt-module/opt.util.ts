import { TimeUnit } from '@sky-club/common';
import TimeUnitUtil from '@/utils/time.unit.util';
import { randomInt } from 'node:crypto';

export type OPT = {
  code: string;
  expiry: number;
};

/**
 * 生成 6 位 OPT（一次性验证码）
 */
export const createOPT = (expireIn?: TimeUnit): OPT => {
  const code = randomInt(100000, 1000000).toString();
  const expiry = TimeUnitUtil.toMS(expireIn || '5m');
  return { code, expiry };
};
