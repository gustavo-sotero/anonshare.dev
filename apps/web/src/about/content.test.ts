import { describe, expect, it } from 'bun:test';
import {
  ABOUT_ARCHITECTURE,
  ABOUT_AUDIENCES,
  ABOUT_DECISIONS,
  ABOUT_EXCLUSIONS,
  ABOUT_LIMITATIONS,
  ABOUT_NEXT_STEPS,
  ABOUT_OPERATIONS,
  ABOUT_SECTION_LINKS,
  getAboutHead,
  getAboutUrl
} from './content';

describe('getAboutUrl', () => {
  it('normalizes the configured public base URL', () => {
    expect(getAboutUrl('https://anonshare.dev/')).toBe('https://anonshare.dev/about');
  });

  it('falls back to the local development origin when no base URL exists', () => {
    expect(getAboutUrl()).toBe('http://localhost:3000/about');
  });
});

describe('getAboutHead', () => {
  it('returns canonical, open graph, and twitter metadata for the About page', () => {
    const head = getAboutHead('https://anonshare.dev/');
    const canonical = head.links.find((link) => link.rel === 'canonical');

    expect(canonical?.href).toBe('https://anonshare.dev/about');
    expect(head.meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'description' }),
        expect.objectContaining({ name: 'robots', content: 'index, follow' }),
        expect.objectContaining({ property: 'og:url', content: 'https://anonshare.dev/about' }),
        expect.objectContaining({ name: 'twitter:card', content: 'summary' })
      ])
    );
  });
});

describe('About content coverage', () => {
  it('covers the main narrative sections required by Module 8', () => {
    expect(ABOUT_SECTION_LINKS.map((entry) => entry.href)).toEqual([
      '#problem',
      '#audience',
      '#goals',
      '#flow',
      '#architecture',
      '#stack',
      '#operations',
      '#decisions',
      '#limitations',
      '#scope',
      '#next'
    ]);
  });

  it('reflects the actual monorepo topology instead of an outdated package count', () => {
    expect(ABOUT_ARCHITECTURE.filter((entry) => entry.kind === 'process')).toHaveLength(3);
    expect(ABOUT_ARCHITECTURE.filter((entry) => entry.kind === 'package')).toHaveLength(3);
  });

  it('makes operational posture explicit instead of leaving observability implicit', () => {
    expect(ABOUT_OPERATIONS.map((entry) => entry.title)).toEqual([
      'Structured logs with request correlation',
      'Health checks that probe real dependencies',
      'Rate limiting on risky public surfaces',
      'Queue and anomaly visibility in the dashboard'
    ]);
  });

  it('keeps the portfolio narrative tied to the implemented audiences, trade-offs, and limits', () => {
    expect(ABOUT_AUDIENCES.map((entry) => entry.title)).toEqual([
      'Anonymous uploader',
      'Recipient',
      'Single admin',
      'Engineer or recruiter'
    ]);

    expect(ABOUT_DECISIONS.map((entry) => entry.decision)).toEqual([
      'One-time download uses a backend-controlled path',
      'Storage is provider-agnostic',
      'Reconciliation is a first-class concern',
      'Auto-hide favors containment over certainty',
      'Web, API, and worker stay separate'
    ]);

    expect(ABOUT_LIMITATIONS.map((entry) => entry.title)).toEqual([
      'Uploads are server-mediated in v1',
      'Preview is intentionally narrow',
      'Moderation is intentionally simple',
      'The product favors depth over breadth'
    ]);

    expect(ABOUT_EXCLUSIONS.map((entry) => entry.label)).toEqual([
      'Multi-user accounts',
      'Billing & subscriptions',
      'End-to-end encryption',
      'Malware scanning',
      'Password-protected shares',
      'Multi-admin support',
      'Folder & collaboration features'
    ]);
  });

  it('describes roadmap items together with their impact on the system', () => {
    for (const step of ABOUT_NEXT_STEPS) {
      expect(step.impact.length).toBeGreaterThan(20);
    }
  });
});
