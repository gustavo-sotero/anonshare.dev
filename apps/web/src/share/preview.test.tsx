import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewPanel } from './preview';

describe('PreviewPanel SSR', () => {
  it('renders a visible accessibility note for video previews', () => {
    const html = renderToStaticMarkup(
      <PreviewPanel url="https://example.test/file.mp4" mimeType="video/mp4" />
    );

    expect(html).toContain('<video');
    expect(html).toContain('Captions and transcripts are not available for user-uploaded files.');
  });

  it('renders the text preview loading shell before hydration', () => {
    const html = renderToStaticMarkup(
      <PreviewPanel url="https://example.test/file.txt" mimeType="text/plain" />
    );

    expect(html).toContain('Loading preview');
    expect(html).toContain('preview-panel__loading');
  });
});
