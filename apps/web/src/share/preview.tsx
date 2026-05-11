import { useEffect, useState } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;
const TEXT_PREVIEW_TIMEOUT_MS = 15_000;

// ─── Text preview fetch ───────────────────────────────────────────────────────

export async function readTextPreview(
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; truncated: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TEXT_PREVIEW_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  }

  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error('Preview request failed');
    }

    if (!response.body) {
      const text = await response.text();
      return {
        text: text.slice(0, maxBytes),
        truncated: text.length > maxBytes
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let streamDone = false;
    let truncated = false;

    while (received < maxBytes) {
      const { done, value } = await reader.read();
      streamDone = done;

      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      const remaining = maxBytes - received;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        received += value.byteLength;
        continue;
      }

      chunks.push(value.subarray(0, remaining));
      received += remaining;
      truncated = true;
      break;
    }

    if (!truncated && !streamDone) {
      const probe = await reader.read();
      truncated = !probe.done;
    }

    await reader.cancel().catch(() => {});

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      text: new TextDecoder().decode(bytes),
      truncated
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (!timedOut) {
        throw err;
      }

      throw new Error('Preview request timed out');
    }

    throw err;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

// ─── TextPreview component ────────────────────────────────────────────────────

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setText(null);
    setIsTruncated(false);
    setError(false);

    readTextPreview(url, TEXT_PREVIEW_MAX_BYTES, controller.signal)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setIsTruncated(result.truncated);
        setText(result.text);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  if (error) return <p className="preview-panel__error">Could not load text preview.</p>;
  if (text === null) return <p className="preview-panel__loading">Loading preview…</p>;

  return (
    <div className="preview-panel preview-panel--text">
      <pre className="preview-panel__pre">{text}</pre>
      {isTruncated && (
        <p className="preview-panel__loading">Preview truncated to the first 64 KB.</p>
      )}
    </div>
  );
}

// ─── PreviewPanel component ───────────────────────────────────────────────────

/**
 * Renders an appropriate in-browser preview for a file served at `url`.
 *
 * Accessibility note: user-uploaded audio and video are served without captions
 * or transcripts because the platform has no mechanism to generate or attach
 * them.  A visible notice is shown below media previews to make this explicit
 * to assistive-technology users rather than silently suppressing the linter
 * warning.
 */
export function PreviewPanel({ url, mimeType }: { url: string; mimeType: string }) {
  const base = (mimeType.split(';')[0] ?? mimeType).trim();

  if (base.startsWith('image/')) {
    return (
      <div className="preview-panel">
        <img src={url} alt="File preview" className="preview-panel__image" />
      </div>
    );
  }

  if (base.startsWith('video/')) {
    return (
      <div className="preview-panel">
        {/* biome-ignore lint/a11y/useMediaCaption: captions are unavailable for user-uploaded content; the notice below informs assistive technology users */}
        <video src={url} controls playsInline className="preview-panel__video" />
        <p className="preview-panel__a11y-note">
          Captions and transcripts are not available for user-uploaded files.
        </p>
      </div>
    );
  }

  if (base.startsWith('audio/')) {
    return (
      <div className="preview-panel">
        {/* biome-ignore lint/a11y/useMediaCaption: captions are unavailable for user-uploaded content; the notice below informs assistive technology users */}
        <audio src={url} controls className="preview-panel__audio" />
        <p className="preview-panel__a11y-note">
          A transcript is not available for user-uploaded audio.
        </p>
      </div>
    );
  }

  if (base === 'application/pdf') {
    return (
      <div className="preview-panel preview-panel--embed">
        <iframe src={url} title="PDF preview" className="preview-panel__iframe" />
      </div>
    );
  }

  if (base.startsWith('text/')) {
    return <TextPreview url={url} />;
  }

  return null;
}
