import { SiteFrame } from '../components/site-frame';
import { PRIVACY_HERO, PRIVACY_SECTIONS } from './privacy-content';

export function PrivacyPage() {
  return (
    <SiteFrame
      eyebrow={PRIVACY_HERO.eyebrow}
      title={PRIVACY_HERO.title}
      summary={PRIVACY_HERO.summary}
      noRail
    >
      {PRIVACY_SECTIONS.map((section) => (
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
