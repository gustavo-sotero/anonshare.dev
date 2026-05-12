import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicReportPanel } from './report-panel';

const noop = () => {};

describe('PublicReportPanel SSR', () => {
  it('renders the inline trigger when the panel is collapsed', () => {
    const html = renderToStaticMarkup(
      <PublicReportPanel
        reportOpen={false}
        reportReason="spam"
        reportMessage=""
        reportPhase="idle"
        reportError={null}
        onOpen={noop}
        onReasonChange={noop}
        onMessageChange={noop}
        onSubmit={noop}
        onCancel={noop}
      />
    );

    expect(html).toContain('report it');
    expect(html).not.toContain('id="report-reason"');
  });

  it('renders labelled form controls when the panel is open', () => {
    const html = renderToStaticMarkup(
      <PublicReportPanel
        reportOpen
        reportReason="malware"
        reportMessage="Suspicious payload"
        reportPhase="idle"
        reportError={null}
        onOpen={noop}
        onReasonChange={noop}
        onMessageChange={noop}
        onSubmit={noop}
        onCancel={noop}
      />
    );

    expect(html).toContain('for="report-reason"');
    expect(html).toContain('id="report-reason"');
    expect(html).toContain('for="report-message"');
    expect(html).toContain('id="report-message"');
    expect(html).toContain('Submit report');
    expect(html).toContain('Suspicious payload');
  });
});
