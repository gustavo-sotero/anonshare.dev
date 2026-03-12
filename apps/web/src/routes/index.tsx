import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: 'anonshare — share files without a trace' }]
  }),
  component: HomePage
});

// ─── types ────────────────────────────────────────────────────────────────────

type ExpirationPreset = 'none' | '1h' | '24h' | '7d' | '30d';

type UploadPhase =
  | { kind: 'idle' }
  | { kind: 'selected'; file: File }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; shareToken: string; shareUrl: string; expiresAt: string | null }
  | { kind: 'error'; message: string; file: File | null };

const EXPIRATION_LABELS: Record<ExpirationPreset, string> = {
  none: 'No expiration',
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days'
};

const EXPIRATION_MS: Record<Exclude<ExpirationPreset, 'none'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function expiresAtFromPreset(preset: ExpirationPreset): string | null {
  if (preset === 'none') return null;
  return new Date(Date.now() + EXPIRATION_MS[preset]).toISOString();
}

function uploadFile(
  file: File,
  options: { oneTime: boolean; allowPreview: boolean; expiresAt: string | null },
  onProgress: (pct: number) => void
): Promise<{ shareToken: string; shareUrl: string; expiresAt: string | null }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('oneTime', String(options.oneTime));
    form.append('allowPreview', String(options.allowPreview));
    if (options.expiresAt) form.append('expiresAt', options.expiresAt);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      try {
        const parsed = JSON.parse(xhr.responseText) as unknown;
        if (
          xhr.status >= 200 &&
          xhr.status < 300 &&
          typeof parsed === 'object' &&
          parsed !== null &&
          'ok' in parsed &&
          (parsed as { ok: boolean }).ok
        ) {
          const data = (
            parsed as {
              ok: true;
              data: { shareToken: string; shareUrl: string; expiresAt: string | null };
            }
          ).data;
          resolve(data);
        } else {
          const msg =
            typeof parsed === 'object' &&
            parsed !== null &&
            'error' in parsed &&
            typeof (parsed as { error: { message?: string } }).error?.message === 'string'
              ? (parsed as { error: { message: string } }).error.message
              : 'Upload failed. Please try again.';
          reject(new Error(msg));
        }
      } catch {
        reject(new Error('Unexpected response from server.'));
      }
    });

    xhr.addEventListener('error', () =>
      reject(new Error('Network error. Please check your connection.'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    xhr.send(form);
  });
}

// ─── component ────────────────────────────────────────────────────────────────

function HomePage() {
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' });
  const [oneTime, setOneTime] = useState(false);
  const [allowPreview, setAllowPreview] = useState(false);
  const [expiration, setExpiration] = useState<ExpirationPreset>('none');
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectFile = useCallback((file: File) => {
    setPhase({ kind: 'selected', file });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) selectFile(file);
    },
    [selectFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) selectFile(file);
    },
    [selectFile]
  );

  const handleOneTimeChange = useCallback((checked: boolean) => {
    setOneTime(checked);
    if (checked) setAllowPreview(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    const file =
      phase.kind === 'selected' ? phase.file : phase.kind === 'error' ? phase.file : null;

    if (!file) return;

    setPhase({ kind: 'uploading', progress: 0 });

    try {
      const result = await uploadFile(
        file,
        { oneTime, allowPreview, expiresAt: expiresAtFromPreset(expiration) },
        (pct) => setPhase({ kind: 'uploading', progress: pct })
      );
      setPhase({ kind: 'done', ...result });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed.',
        file
      });
    }
  }, [phase, oneTime, allowPreview, expiration]);

  const copyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — ignore
    }
  }, []);

  const reset = useCallback(() => {
    setPhase({ kind: 'idle' });
    setOneTime(false);
    setAllowPreview(false);
    setExpiration('none');
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const selectedFile =
    phase.kind === 'selected' ? phase.file : phase.kind === 'error' ? phase.file : null;

  return (
    <SiteFrame
      eyebrow="Anonymous file sharing"
      title="Share files without a trace."
      summary="No accounts, no tracking. Upload a file, configure its access rules, and send the link — that's it."
    >
      {/* ── Success screen ─────────────────────────────────────────────────── */}
      {phase.kind === 'done' && (
        <section className="panel panel--feature">
          <div className="panel__row">
            <p className="panel__label">Link ready</p>
            <span className="chip">Upload complete</span>
          </div>

          <div className="share-result">
            <div className="share-result__url">{phase.shareUrl}</div>
            <div className="share-result__actions">
              <button
                type="button"
                className="button-link"
                onClick={() => copyLink(phase.shareUrl)}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <a
                href={phase.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="button-link button-link--ghost"
              >
                Open link
              </a>
            </div>
          </div>

          {phase.expiresAt && (
            <p className="upload-meta-note">
              Expires{' '}
              {new Date(phase.expiresAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
              })}
            </p>
          )}

          <button type="button" className="upload-reset-link" onClick={reset}>
            Upload another file
          </button>
        </section>
      )}

      {/* ── Upload form ────────────────────────────────────────────────────── */}
      {phase.kind !== 'done' && (
        <>
          <section className="panel panel--feature">
            <div className="panel__row">
              <p className="panel__label">Drop a file</p>
              {phase.kind === 'error' && <span className="chip chip--error">Error</span>}
            </div>

            {/* Drop zone — label activates file input on click; drag handlers enable drop */}
            <label
              className={`drop-zone${dragOver ? ' drop-zone--active' : ''}${selectedFile ? ' drop-zone--selected' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="drop-zone__input"
                onChange={handleFileInput}
              />

              {selectedFile ? (
                <div className="drop-zone__file-info">
                  <span className="drop-zone__filename">{selectedFile.name}</span>
                  <span className="drop-zone__meta">
                    {selectedFile.type || 'unknown type'} · {formatBytes(selectedFile.size)}
                  </span>
                </div>
              ) : (
                <div className="drop-zone__prompt">
                  <span className="drop-zone__icon" aria-hidden="true">
                    ⊕
                  </span>
                  <span>Drag a file here or click to browse</span>
                  <span className="drop-zone__hint">Up to 256 MB · any file type</span>
                </div>
              )}
            </label>

            {phase.kind === 'error' && <p className="upload-error">{phase.message}</p>}

            {/* Upload progress */}
            {phase.kind === 'uploading' && (
              <div
                className="upload-progress"
                role="progressbar"
                aria-valuenow={phase.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="upload-progress__bar" style={{ width: `${phase.progress}%` }} />
                <span className="upload-progress__label">{phase.progress}%</span>
              </div>
            )}
          </section>

          {/* Options */}
          <section className="panel">
            <div className="panel__row">
              <p className="panel__label">Access rules</p>
            </div>

            <div className="options-grid">
              {/* One-time download */}
              <label className="option-row">
                <div className="option-row__text">
                  <span className="option-row__name">One-time download</span>
                  <span className="option-row__desc">
                    The link stops working after the first download.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={oneTime}
                  className={`toggle${oneTime ? ' toggle--on' : ''}`}
                  onClick={() => handleOneTimeChange(!oneTime)}
                >
                  <span className="toggle__thumb" />
                </button>
              </label>

              {/* Allow preview */}
              <label className={`option-row${oneTime ? ' option-row--disabled' : ''}`}>
                <div className="option-row__text">
                  <span className="option-row__name">Allow preview</span>
                  <span className="option-row__desc">
                    {oneTime
                      ? 'Preview is incompatible with one-time download.'
                      : 'Recipients can preview supported file types in their browser.'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowPreview}
                  disabled={oneTime}
                  className={`toggle${allowPreview && !oneTime ? ' toggle--on' : ''}${oneTime ? ' toggle--locked' : ''}`}
                  onClick={() => {
                    if (!oneTime) setAllowPreview((v) => !v);
                  }}
                >
                  <span className="toggle__thumb" />
                </button>
              </label>

              {/* Expiration */}
              <div className="option-row option-row--select">
                <div className="option-row__text">
                  <span className="option-row__name">Expires after</span>
                  <span className="option-row__desc">
                    Maximum 30 days. Leave unset for no expiration.
                  </span>
                </div>
                <div className="expiry-group">
                  {(['none', '1h', '24h', '7d', '30d'] as ExpirationPreset[]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`expiry-btn${expiration === preset ? ' expiry-btn--active' : ''}`}
                      onClick={() => setExpiration(preset)}
                    >
                      {EXPIRATION_LABELS[preset]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Submit */}
          <section className="panel panel--muted">
            <div className="action-row">
              <button
                type="button"
                className="button-link"
                disabled={!selectedFile || phase.kind === 'uploading'}
                onClick={handleSubmit}
              >
                {phase.kind === 'uploading'
                  ? 'Uploading…'
                  : phase.kind === 'error' && selectedFile
                    ? 'Retry upload'
                    : 'Upload and generate link'}
              </button>
              {selectedFile && phase.kind !== 'uploading' && (
                <button type="button" className="button-link button-link--ghost" onClick={reset}>
                  Clear
                </button>
              )}
            </div>
            <p className="upload-footer-note">
              Files are anonymous. No account required.{' '}
              <Link to="/about" className="inline-link">
                Read more about how this works.
              </Link>
            </p>
          </section>
        </>
      )}
    </SiteFrame>
  );
}
