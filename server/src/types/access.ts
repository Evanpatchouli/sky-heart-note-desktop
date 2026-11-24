import { Maybe } from '@webapp-template/common';
import type { SessionUser } from '../auth/app-access';

export interface AccessInfo {
  ip: string;
  userAgent: string;
  xtimestamp: Maybe<string | number>;
  xnonce: Maybe<string | number>;
  user?: Maybe<SessionUser>;
}
