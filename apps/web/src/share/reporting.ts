const REPORTABLE_UNAVAILABLE_CODES = new Set(['file_expired', 'file_consumed']);

export function canReportUnavailableFile(code: string | null | undefined): boolean {
  if (!code) {
    return false;
  }

  return REPORTABLE_UNAVAILABLE_CODES.has(code);
}