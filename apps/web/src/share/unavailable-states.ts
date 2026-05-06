// Unavailability state copy for public share page rendering.
//
// Disclosure policy:
// - file_expired and file_consumed may name the state explicitly because
//   they are non-sensitive lifecycle facts that help the user understand the outcome.
// - file_hidden must NOT reveal that the file was moderated or flagged. The domain-layer
//   posture is non-disclosure for moderated content, so the copy is intentionally vague.
// - file_deleted avoids "by the operator" to stay neutral and avoid revealing the cause.
// - file_unavailable and not_found use generic copy that does not over-promise recovery.

export type UnavailabilityInfo = {
  label: string;
  message: string;
};

export const UNAVAILABILITY: Record<string, UnavailabilityInfo> = {
  file_expired: {
    label: 'Expired',
    message: 'This file has expired and is no longer available for download.'
  },
  file_consumed: {
    label: 'Already downloaded',
    message: 'This one-time link has already been used. The file is no longer available.'
  },
  // Intentionally generic: must not reveal that the file was moderated or flagged.
  file_hidden: {
    label: 'Unavailable',
    message: 'This file is not available.'
  },
  file_deleted: {
    label: 'Deleted',
    message: 'This file has been deleted and cannot be retrieved.'
  },
  file_unavailable: {
    label: 'Unavailable',
    message: 'This file is not available right now.'
  },
  not_found: {
    label: 'Not found',
    message: "This link doesn't match any file we have. It may never have existed."
  }
};

export function getUnavailabilityInfo(code: string, fallbackMessage?: string): UnavailabilityInfo {
  return (
    UNAVAILABILITY[code] ?? {
      label: 'Unavailable',
      message: fallbackMessage || 'This file is not available right now.'
    }
  );
}

// Maps a file lifecycle code to a visual icon for the unavailable-state panel.
// Returns a deterministic string so callers can test the mapping without rendering.
export function getUnavailabilityIcon(code: string): string {
  if (code === 'file_expired') return '⏳';
  if (code === 'file_consumed') return '✓';
  return '⊘';
}
