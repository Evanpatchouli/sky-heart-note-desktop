import { ValuesOf } from '@sky-club/common';

export const LoginTypes = {
  SHARED: 'shared',
  PHONE: 'phone',
  ACCOUNT: 'account',
  EMAIL: 'email'
} as const;

export type LoginType = ValuesOf<typeof LoginTypes>;
