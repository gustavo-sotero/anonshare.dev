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

  it('rebuilds clean token-scoped state after a previous token mutated local ui state', () => {
    const previousTokenState = {
      ...createInitialSharePageUiState('other'),
      downloadState: 'error' as const,
      downloadError: 'Download failed',
      previewState: 'ready' as const,
      previewUrl: 'https://storage.example.com/preview',
      previewMime: 'image/png',
      consumed: true,
      runtimeUnavailable: {
        code: 'file_consumed',
        message: 'This one-time link has already been used.'
      },
      reportOpen: true,
      reportReason: 'spam' as const,
      reportMessage: 'Suspicious payload',
      reportPhase: 'error' as const,
      reportError: 'Report failed'
    };

    const nextTokenState = createInitialSharePageUiState();

    expect(previousTokenState).toMatchObject({
      consumed: true,
      previewState: 'ready',
      reportOpen: true,
      reportPhase: 'error'
    });
    expect(nextTokenState).toEqual({
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
});
