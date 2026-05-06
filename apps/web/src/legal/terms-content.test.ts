import { describe, expect, it } from 'bun:test';
import { getTermsHead, getTermsUrl, TERMS_PAGE_PATH, TERMS_SECTIONS } from './terms-content';

describe('getTermsUrl', () => {
  it('normalizes the configured public base URL', () => {
    expect(getTermsUrl('https://anonshare.dev/')).toBe('https://anonshare.dev/terms');
  });

  it('falls back to the local development origin when no base URL exists', () => {
    expect(getTermsUrl()).toBe('http://localhost:3000/terms');
  });
});

describe('getTermsHead', () => {
  it('returns canonical, open graph, and indexable metadata', () => {
    const head = getTermsHead('https://anonshare.dev/');
    const canonical = head.links.find((link) => link.rel === 'canonical');

    expect(canonical?.href).toBe('https://anonshare.dev/terms');
    expect(head.meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'description' }),
        expect.objectContaining({ name: 'robots', content: 'index, follow' }),
        expect.objectContaining({ property: 'og:url', content: 'https://anonshare.dev/terms' })
      ])
    );
  });
});

describe('TERMS_PAGE_PATH', () => {
  it('is /terms', () => {
    expect(TERMS_PAGE_PATH).toBe('/terms');
  });
});

describe('Terms content coverage', () => {
  it('contains all required section IDs', () => {
    const ids = TERMS_SECTIONS.map((s) => s.id);

    expect(ids).toContain('service');
    expect(ids).toContain('uploads');
    expect(ids).toContain('access-rules');
    expect(ids).toContain('moderation');
    expect(ids).toContain('preview');
    expect(ids).toContain('prohibited');
    expect(ids).toContain('availability');
    expect(ids).toContain('changes');
  });

  it('every section has a heading and at least one content paragraph', () => {
    for (const section of TERMS_SECTIONS) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(0);
      for (const paragraph of section.content) {
        expect(paragraph.length).toBeGreaterThan(0);
      }
    }
  });

  it('states that the service is non-commercial in the service section', () => {
    const serviceSection = TERMS_SECTIONS.find((s) => s.id === 'service');
    const fullText = serviceSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/non-commercial/i);
  });

  it('covers one-time download semantics in the access-rules section', () => {
    const accessSection = TERMS_SECTIONS.find((s) => s.id === 'access-rules');
    const fullText = accessSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/one-time/i);
    expect(fullText).toMatch(/single successful download/i);
  });

  it('covers report threshold and auto-hide in the moderation section', () => {
    const moderationSection = TERMS_SECTIONS.find((s) => s.id === 'moderation');
    const fullText = moderationSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/report/i);
    expect(fullText).toMatch(/hidden/i);
  });
});
