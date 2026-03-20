import { describe, expect, it } from 'bun:test';
import { reportReasonValues } from '@anonshare/contracts';
import { createInitialSharePageUiState } from './page-state';

describe('createInitialSharePageUiState', () => {
  it('returns clean token-scoped defaults', () => {
    expect(createInitialSharePageUiState()).toEqual({
      downloadState: 'idle',
      downloadError: null,
      previewState: 'hidden',
      previewUrl: null,
      previewMime: '',
      consumed: false,
      runtimeUnavailable: null,
      reportOpen: false,
      reportReason: reportReasonValues[0],
      reportMessage: '',
      reportPhase: 'idle',
      reportError: null
    });
  });

  it('allows overriding the initial report reason', () => {
    expect(createInitialSharePageUiState('spam').reportReason).toBe('spam');
  });
});
