import { SiteFrame } from '../components/site-frame';
import { TERMS_HERO, TERMS_SECTIONS } from './terms-content';

export function TermsPage() {
  return (
    <SiteFrame
      eyebrow={TERMS_HERO.eyebrow}
      title={TERMS_HERO.title}
      summary={TERMS_HERO.summary}
      noRail
    >
      {TERMS_SECTIONS.map((section) => (
        <section
          key={section.id}
          className="about-section"
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
        >
          <h2 className="panel__label" id={`${section.id}-heading`}>
            {section.heading}
          </h2>
          {section.content.map((paragraph, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static ordered content, index is stable
            <p key={index} className="about-prose__body">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </SiteFrame>
  );
}
