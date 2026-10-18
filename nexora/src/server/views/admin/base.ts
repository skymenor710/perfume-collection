import type { Assets } from '../../lib/assets';
import type { SessionInfo } from '../../context';
import type { contactRequests } from '../../db/schema';
import type { Flash } from './layout';

export type RequestRow = typeof contactRequests.$inferSelect;

export interface Base {
  session: SessionInfo;
  assets: Assets;
  flash?: Flash | null;
  newRequests: number;
}
