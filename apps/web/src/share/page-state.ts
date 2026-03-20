import { reportReasonValues } from '@anonshare/contracts';

export type ReportReason = (typeof reportReasonValues)[number];

export type SharePageUiState = {
  downloadState: 'idle' | 'fetching' | 'error';
  downloadError: string | null;
  previewState: 'hidden' | 'loading' | 'ready' | 'error';
  previewUrl: string | null;
  previewMime: string;
  consumed: boolean;
  runtimeUnavailable: {
    code: string;
    message: string;
  } | null;
  reportOpen: boolean;
  reportReason: ReportReason;
  reportMessage: string;
  reportPhase: 'idle' | 'submitting' | 'success' | 'error';
  reportError: string | null;
};

export function createInitialSharePageUiState(
  initialReportReason: ReportReason = reportReasonValues[0]
): SharePageUiState {
  return {
    downloadState: 'idle',
    downloadError: null,
    previewState: 'hidden',
    previewUrl: null,
    previewMime: '',
    consumed: false,
    runtimeUnavailable: null,
    reportOpen: false,
    reportReason: initialReportReason,
    reportMessage: '',
    reportPhase: 'idle',
    reportError: null
  };
}
