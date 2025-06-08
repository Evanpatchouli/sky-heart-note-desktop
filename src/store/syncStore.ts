import { UnwrapPromise } from '#/types';
import { sql } from '../utils/index';
const syncStore = {
  db: null as UnwrapPromise<ReturnType<typeof sql['load']>> | null,
}

export default syncStore;