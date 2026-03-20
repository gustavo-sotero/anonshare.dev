import type { AdminFileSummary, AdminOverviewResponse } from '@anonshare/contracts';

export type AdminModerationAction = 'hide' | 'restore' | 'delete';

export function canHideFileStatus(status: AdminFileSummary['status']): boolean {
  return status === 'active' || status === 'expiring';
}

export function getModerationConfirmationMessage(
  action: AdminModerationAction,
  targetLabel: string
): string | null {
  switch (action) {
    case 'hide':
      return `Hide ${targetLabel}? This immediately blocks public downloads and previews.`;
    case 'delete':
      return `Delete ${targetLabel}? This immediately removes public access and schedules storage cleanup.`;
    case 'restore':
      return null;
  }
}

export function buildStorageHighlights(overview: AdminOverviewResponse, files: AdminFileSummary[]) {
  return {
    totalStorageBytes: overview.totalStorageBytes,
    activeFileCount: (overview.byStatus.active ?? 0) + (overview.byStatus.expiring ?? 0),
    nonPublicFileCount:
      (overview.byStatus.hidden ?? 0) +
      (overview.byStatus.deleted ?? 0) +
      (overview.byStatus.expired ?? 0) +
      (overview.byStatus.consumed ?? 0),
    largestFile: files[0] ?? null
  };
}

/**
 * Prompt the user for confirmation before a moderation action.
 * Returns true when the action should proceed (no message required or user confirmed).
 */
export function confirmModerationAction(
  action: AdminModerationAction,
  targetLabel: string
): boolean {
  const message = getModerationConfirmationMessage(action, targetLabel);
  if (!message) return true;
  return window.confirm(message);
}
