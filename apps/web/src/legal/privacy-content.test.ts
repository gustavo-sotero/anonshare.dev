import { describe, expect, it } from 'bun:test';
import {
  getPrivacyHead,
  getPrivacyUrl,
  PRIVACY_PAGE_PATH,
  PRIVACY_SECTIONS
} from './privacy-content';

describe('getPrivacyUrl', () => {
  it('normalizes the configured public base URL', () => {
    expect(getPrivacyUrl('https://anonshare.dev/')).toBe('https://anonshare.dev/privacy');
  });

  it('falls back to the local development origin when no base URL exists', () => {
    expect(getPrivacyUrl()).toBe('http://localhost:3000/privacy');
  });
});

describe('getPrivacyHead', () => {
  it('returns canonical, open graph, and indexable metadata', () => {
    const head = getPrivacyHead('https://anonshare.dev/');
    const canonical = head.links.find((link) => link.rel === 'canonical');

    expect(canonical?.href).toBe('https://anonshare.dev/privacy');
    expect(head.meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'description' }),
        expect.objectContaining({ name: 'robots', content: 'index, follow' }),
        expect.objectContaining({ property: 'og:url', content: 'https://anonshare.dev/privacy' })
      ])
    );
  });
});

describe('PRIVACY_PAGE_PATH', () => {
  it('is /privacy', () => {
    expect(PRIVACY_PAGE_PATH).toBe('/privacy');
  });
});

describe('Privacy content coverage', () => {
  it('contains all required section IDs', () => {
    const ids = PRIVACY_SECTIONS.map((s) => s.id);

    expect(ids).toContain('model');
    expect(ids).toContain('stored-data');
    expect(ids).toContain('share-links');
    expect(ids).toContain('reports');
    expect(ids).toContain('admin');
    expect(ids).toContain('logging');
    expect(ids).toContain('retention');
    expect(ids).toContain('contact');
  });

  it('every section has a heading and at least one content paragraph', () => {
    for (const section of PRIVACY_SECTIONS) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(0);
      for (const paragraph of section.content) {
        expect(paragraph.length).toBeGreaterThan(0);
      }
    }
  });

  it('describes the anonymous upload model in the model section', () => {
    const modelSection = PRIVACY_SECTIONS.find((s) => s.id === 'model');
    const fullText = modelSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/no user accounts/i);
    expect(fullText).toMatch(/non-commercial/i);
  });

  it('mentions the share token is randomly generated in the stored-data section', () => {
    const storedSection = PRIVACY_SECTIONS.find((s) => s.id === 'stored-data');
    const fullText = storedSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/randomly generated/i);
    expect(fullText).toMatch(/unguessable/i);
  });

  it('states that share pages are noindex in the share-links section', () => {
    const shareSection = PRIVACY_SECTIONS.find((s) => s.id === 'share-links');
    const fullText = shareSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/noindex/i);
  });

  it('states the admin is a single allowlisted GitHub identity in the admin section', () => {
    const adminSection = PRIVACY_SECTIONS.find((s) => s.id === 'admin');
    const fullText = adminSection?.content.join(' ') ?? '';

    expect(fullText).toMatch(/one administrator/i);
    expect(fullText).toMatch(/allowlisted/i);
    expect(fullText).toMatch(/GitHub/i);
  });

  it('does not claim stronger data-minimization guarantees than the system provides', () => {
    const fullText = PRIVACY_SECTIONS.flatMap((s) => s.content).join(' ');

    // Must not claim GDPR/CCPA compliance that the project does not provide
    expect(fullText).not.toMatch(/GDPR compliant/i);
    expect(fullText).not.toMatch(/CCPA compliant/i);
    // Must not claim it never logs IPs — it says "may" to stay accurate
    expect(fullText).not.toMatch(/never log/i);
  });
});
