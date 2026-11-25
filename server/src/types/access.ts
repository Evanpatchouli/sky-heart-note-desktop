import { Maybe } from '@sky-club/common';
import type { SessionUser } from '../auth/app-access';

export interface AccessInfo {
  ip: string;
  userAgent: string;
  xtimestamp: Maybe<string | number>;
  xnonce: Maybe<string | number>;
  user?: Maybe<SessionUser>;
}
