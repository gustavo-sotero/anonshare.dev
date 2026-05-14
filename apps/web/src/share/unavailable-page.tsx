import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SiteFrame } from '~/components/site-frame';
import {
  getUnavailabilityIcon,
  getUnavailabilityInfo,
  type UnavailabilityInfo
} from '~/share/unavailable-states';

export type { UnavailabilityInfo };

export type UnavailableFilePageProps = {
  code: string;
  info: UnavailabilityInfo;
  reportPanel?: ReactNode;
};

/**
 * Full-page shell for files that cannot be accessed.
 *
 * Used in two situations:
 * 1. The SSR loader determines the file is unavailable before the page mounts.
 * 2. The client detects that a previously valid file became unavailable during
 *    the current session (e.g., one-time download consumed by another request).
 *
 * An optional `reportPanel` slot lets the caller inject a report form for
 * cases where reporting is still eligible (e.g., expired or hidden files).
 */
export function UnavailableFilePage({ code, info, reportPanel }: UnavailableFilePageProps) {
  return (
    <SiteFrame eyebrow="File link" title={info.label} summary={info.message} noRail>
      <section className="panel panel--unavailable" data-testid="unavailable">
        <div className="unavail-icon" aria-hidden="true">
          {getUnavailabilityIcon(code)}
        </div>
        <p className="unavail-message">{info.message}</p>
        <div className="action-row">
          <Link to="/" className="button-link">
            Share a new file
          </Link>
        </div>
      </section>
      {reportPanel}
    </SiteFrame>
  );
}

/**
 * Convenience factory: builds an `UnavailableFilePage` from a raw error code
 * and optional override message without requiring callers to call
 * `getUnavailabilityInfo` directly.
 */
export function UnavailableFilePageFromCode({
  code,
  errorMessage,
  reportPanel
}: {
  code: string;
  errorMessage?: string | null;
  reportPanel?: ReactNode;
}) {
  const info = getUnavailabilityInfo(code, errorMessage ?? undefined);
  return <UnavailableFilePage code={code} info={info} reportPanel={reportPanel} />;
}
