// File lifecycle states
export type FileStatus = 'active' | 'expiring' | 'expired' | 'hidden' | 'deleted' | 'consumed';

// Valid transitions: active → expiring → expired
//                   active | expiring → hidden (moderation)
//                   active | expiring | hidden → deleted (admin)
//                   active → consumed (one-time download)
export const FILE_STATUS_TRANSITIONS: Record<FileStatus, FileStatus[]> = {
  active: ['expiring', 'hidden', 'deleted', 'consumed'],
  expiring: ['expired', 'hidden', 'deleted'],
  expired: ['deleted'],
  hidden: ['active', 'deleted'],
  deleted: [],
  consumed: []
};

export function isTransitionAllowed(from: FileStatus, to: FileStatus): boolean {
  return FILE_STATUS_TRANSITIONS[from].includes(to);
}

export function isPubliclyAccessible(status: FileStatus): boolean {
  return status === 'active' || status === 'expiring';
}
