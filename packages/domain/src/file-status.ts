// File lifecycle states
export const FILE_STATUS_VALUES = [
  'pending_upload',
  'active',
  'expiring',
  'expired',
  'hidden',
  'deleted',
  'consumed',
  'missing'
] as const;

export type FileStatus = (typeof FILE_STATUS_VALUES)[number];

export type PublicFileStatus = Extract<FileStatus, 'active' | 'expiring'>;

export const PUBLIC_FILE_STATUS_VALUES = ['active', 'expiring'] as const satisfies readonly [
  PublicFileStatus,
  ...PublicFileStatus[]
];

export type UnavailableFileStatus = Exclude<FileStatus, PublicFileStatus>;

export const FILE_STATUS_TRANSITION_TRIGGER_VALUES = [
  'automatic',
  'manual',
  'reconciliation'
] as const;

export type FileStatusTransitionTrigger = (typeof FILE_STATUS_TRANSITION_TRIGGER_VALUES)[number];

export type FileStatusTransitionRule = {
  from: FileStatus;
  to: FileStatus;
  triggers: readonly [FileStatusTransitionTrigger, ...FileStatusTransitionTrigger[]];
  reason: string;
};

export const UNAVAILABLE_FILE_STATUS_VALUES = [
  'pending_upload',
  'expired',
  'hidden',
  'deleted',
  'consumed',
  'missing'
] as const satisfies readonly [UnavailableFileStatus, ...UnavailableFileStatus[]];

export const FILE_STATUS_TRANSITION_RULES = [
  {
    from: 'pending_upload',
    to: 'active',
    triggers: ['automatic'],
    reason: 'The upload becomes public only after metadata and object storage are consistent.'
  },
  {
    from: 'pending_upload',
    to: 'deleted',
    triggers: ['automatic', 'manual'],
    reason: 'Failed or abandoned uploads are discarded instead of becoming public.'
  },
  {
    from: 'active',
    to: 'expiring',
    triggers: ['automatic'],
    reason:
      'Lifecycle processing may mark a file as close to expiration for operational or UI purposes.'
  },
  {
    from: 'active',
    to: 'expired',
    triggers: ['automatic'],
    reason: 'Files become unavailable immediately when their expiration window elapses.'
  },
  {
    from: 'active',
    to: 'hidden',
    triggers: ['automatic', 'manual'],
    reason:
      'Files can be hidden either by admin action or automatically after abuse thresholds are reached.'
  },
  {
    from: 'active',
    to: 'deleted',
    triggers: ['manual'],
    reason: 'Administrative deletion is an explicit destructive action.'
  },
  {
    from: 'active',
    to: 'consumed',
    triggers: ['automatic'],
    reason: 'A successful one-time download consumes the file and closes public access.'
  },
  {
    from: 'active',
    to: 'missing',
    triggers: ['reconciliation'],
    reason:
      'Reconciliation may quarantine a publicly available file when its metadata no longer matches storage reality.'
  },
  {
    from: 'expiring',
    to: 'expired',
    triggers: ['automatic'],
    reason: 'Expiring files eventually move into the terminal expired state.'
  },
  {
    from: 'expiring',
    to: 'hidden',
    triggers: ['automatic', 'manual'],
    reason: 'Moderation still overrides availability while a file is nearing expiration.'
  },
  {
    from: 'expiring',
    to: 'deleted',
    triggers: ['manual'],
    reason: 'Administrative deletion remains available before the file naturally expires.'
  },
  {
    from: 'expiring',
    to: 'consumed',
    triggers: ['automatic'],
    reason:
      'A one-time file stays consumable while expiring, and a successful delivery still closes public access.'
  },
  {
    from: 'expiring',
    to: 'missing',
    triggers: ['reconciliation'],
    reason:
      'Reconciliation may quarantine an expiring file when its public metadata points to a missing or inconsistent object.'
  },
  {
    from: 'expired',
    to: 'deleted',
    triggers: ['automatic', 'manual', 'reconciliation'],
    reason:
      'Cleanup or reconciliation may remove expired records and objects once they are no longer needed.'
  },
  {
    from: 'hidden',
    to: 'active',
    triggers: ['manual'],
    reason: 'An administrator may restore a hidden file after review.'
  },
  {
    from: 'hidden',
    to: 'expiring',
    triggers: ['manual'],
    reason:
      'Restoring a hidden file should preserve its public lifecycle state when it was already expiring.'
  },
  {
    from: 'hidden',
    to: 'expired',
    triggers: ['manual'],
    reason:
      'Restoring a hidden file after its deadline should reveal the expired lifecycle state instead of reactivating it.'
  },
  {
    from: 'hidden',
    to: 'deleted',
    triggers: ['manual'],
    reason: 'A hidden file can be permanently removed after moderation review.'
  },
  {
    from: 'missing',
    to: 'active',
    triggers: ['reconciliation'],
    reason: 'Reconciliation can recover files when the missing-object anomaly is resolved safely.'
  },
  {
    from: 'missing',
    to: 'deleted',
    triggers: ['reconciliation', 'manual'],
    reason: 'Reconciliation or admin action can retire irrecoverable inconsistent records.'
  }
] as const satisfies readonly FileStatusTransitionRule[];

const emptyFileStatusTransitions: Record<FileStatus, FileStatus[]> = {
  pending_upload: [],
  active: [],
  expiring: [],
  expired: [],
  hidden: [],
  deleted: [],
  consumed: [],
  missing: []
};

export const FILE_STATUS_TRANSITIONS: Record<FileStatus, FileStatus[]> = FILE_STATUS_VALUES.reduce(
  (transitions, status) => {
    transitions[status] = FILE_STATUS_TRANSITION_RULES.filter((rule) => rule.from === status).map(
      (rule) => rule.to
    );
    return transitions;
  },
  { ...emptyFileStatusTransitions }
);

export function getTransitionRule(
  from: FileStatus,
  to: FileStatus
): FileStatusTransitionRule | null {
  return FILE_STATUS_TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to) ?? null;
}

export function getAllowedTransitions(from: FileStatus): readonly FileStatusTransitionRule[] {
  return FILE_STATUS_TRANSITION_RULES.filter((rule) => rule.from === from);
}

export function isTransitionTriggeredBy(
  from: FileStatus,
  to: FileStatus,
  trigger: FileStatusTransitionTrigger
): boolean {
  const rule = getTransitionRule(from, to);
  return rule?.triggers.includes(trigger) ?? false;
}

export function isTransitionAllowed(from: FileStatus, to: FileStatus): boolean {
  return getTransitionRule(from, to) !== null;
}

export function isPubliclyAccessible(status: FileStatus): boolean {
  return status === 'active' || status === 'expiring';
}

/**
 * Returns the user-facing unavailability message for a given status, or null
 * when the file is publicly accessible and no message is needed.
 *
 * Messages deliberately avoid leaking internal state (e.g. "hidden" is shown
 * as a generic unavailability notice to prevent information disclosure).
 */
export function getUnavailabilityMessage(status: FileStatus): string | null {
  switch (status) {
    case 'active':
    case 'expiring':
      return null;
    case 'pending_upload':
      return 'This file is still being processed.';
    case 'expired':
      return 'This file has expired and is no longer available.';
    case 'hidden':
      return 'This file is unavailable.';
    case 'deleted':
      return 'This file has been deleted.';
    case 'consumed':
      return 'This file has already been downloaded and is no longer available.';
    case 'missing':
      return 'This file is unavailable.';
  }
}
