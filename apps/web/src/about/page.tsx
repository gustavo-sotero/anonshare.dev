import { QRCodeSVG } from 'qrcode.react';
import { Fragment, useState } from 'react';
import { SiteFrame } from '../components/site-frame';
import {
  ABOUT_ARCHITECTURE,
  ABOUT_AUDIENCES,
  ABOUT_DECISIONS,
  ABOUT_EXCLUSIONS,
  ABOUT_FLOW_STEPS,
  ABOUT_GOALS,
  ABOUT_HERO,
  ABOUT_LIMITATIONS,
  ABOUT_NEXT_STEPS,
  ABOUT_OPERATIONS,
  ABOUT_STACK,
  getAboutSupportConfig
} from './content';

type AboutSupportConfig = ReturnType<typeof getAboutSupportConfig>;

export function AboutPage({
  support = getAboutSupportConfig()
}: Readonly<{ support?: AboutSupportConfig }> = {}) {
  return (
    <SiteFrame
      eyebrow={ABOUT_HERO.eyebrow}
      title={ABOUT_HERO.title}
      summary={ABOUT_HERO.summary}
      noRail
    >
      <SupportSection support={support} />

      <section className="about-section" id="problem" aria-labelledby="problem-heading">
        <h2 className="panel__label" id="problem-heading">
          The problem
        </h2>
        <p className="about-prose__body">
          Most file-sharing tools require an account, track usage, or bury access rules behind
          paywalls. Sometimes the real need is smaller and more immediate: send one file, explain
          how it should behave, and move on.
        </p>
        <p className="about-prose__body">
          anonshare lets anyone upload a file, configure access rules such as one-time download,
          expiration, and preview, then receive a shareable link. The recipient opens the link and
          sees exactly what is available without needing an account on either side of the exchange.
        </p>
        <p className="about-prose__body about-prose__body--muted">
          This project is intentionally non-commercial. It exists to validate a Bun-first stack in a
          realistic product with storage, jobs, abuse controls, and admin operations while also
          being understandable in a portfolio review.
        </p>
      </section>

      <section className="about-section" id="audience" aria-labelledby="audience-heading">
        <h2 className="panel__label" id="audience-heading">
          Who it serves
        </h2>
        <p className="about-prose__body">
          The page is written for four distinct readers: the person sharing a file, the person
          opening the link, the solo operator running the system, and the reviewer trying to assess
          the product and architecture quickly.
        </p>
        <div className="about-note-grid">
          {ABOUT_AUDIENCES.map((entry) => (
            <AboutNoteCard
              key={entry.title}
              eyebrow={entry.eyebrow}
              title={entry.title}
              body={entry.body}
              aside={entry.aside}
            />
          ))}
        </div>
      </section>

      <section className="about-section" id="goals" aria-labelledby="goals-heading">
        <h2 className="panel__label" id="goals-heading">
          What v1 optimizes for
        </h2>
        <p className="about-prose__body">
          v1 is intentionally narrow. The target is not feature breadth; it is a fast anonymous
          flow, clear recipient state, and an operating model that one person can realistically
          understand and maintain.
        </p>
        <div className="about-note-grid about-note-grid--compact">
          {ABOUT_GOALS.map((goal) => (
            <AboutNoteCard
              key={goal.title}
              eyebrow={goal.eyebrow}
              title={goal.title}
              body={goal.body}
            />
          ))}
        </div>
      </section>

      <section className="about-section" id="flow" aria-labelledby="flow-heading">
        <h2 className="panel__label" id="flow-heading">
          System flow
        </h2>
        <p className="about-prose__body">
          From upload to cleanup, the system moves a file through a defined lifecycle with explicit
          transitions rather than informal state hidden inside request handlers.
        </p>
        <div className="about-flow">
          {ABOUT_FLOW_STEPS.map((step, index) => (
            <Fragment key={step.index}>
              <FlowStep index={step.index} label={step.label} desc={step.desc} />
              {index < ABOUT_FLOW_STEPS.length - 1 ? <FlowArrow /> : null}
            </Fragment>
          ))}
        </div>
      </section>

      <section className="panel" id="architecture" aria-labelledby="architecture-heading">
        <h2 className="panel__label" id="architecture-heading">
          Architecture
        </h2>
        <p className="about-prose__body">
          The monorepo splits responsibilities across three independently runnable processes and
          three shared packages. That boundary is deliberate: apps do not import each other, and
          shared rules live in packages instead of drifting across runtime surfaces.
        </p>
        <div className="about-arch-grid">
          {ABOUT_ARCHITECTURE.map((entry) => (
            <ArchCard
              key={entry.name}
              kind={entry.kind}
              name={entry.name}
              purpose={entry.purpose}
              detail={entry.detail}
            />
          ))}
        </div>
      </section>

      <section className="panel panel--muted" id="stack" aria-labelledby="stack-heading">
        <h2 className="panel__label" id="stack-heading">
          Stack choices
        </h2>
        <p className="about-prose__body">
          Each tool was selected for a specific operating reason, not just because it is currently
          fashionable. The stack is part of the product story.
        </p>
        <div className="about-stack-grid">
          {ABOUT_STACK.map((entry) => (
            <StackCard key={entry.tech} tech={entry.tech} why={entry.why} />
          ))}
        </div>
      </section>

      <section className="about-section" id="operations" aria-labelledby="operations-heading">
        <h2 className="panel__label" id="operations-heading">
          Operational controls
        </h2>
        <p className="about-prose__body">
          The system is not presented as a toy upload demo. It includes the minimum operational
          posture needed to make anonymous sharing believable: observability, health checks, abuse
          limits, and a dashboard that surfaces lifecycle issues instead of hiding them.
        </p>
        <div className="about-note-grid about-note-grid--compact">
          {ABOUT_OPERATIONS.map((entry) => (
            <AboutNoteCard
              key={entry.title}
              eyebrow={entry.eyebrow}
              title={entry.title}
              body={entry.body}
              tone="signal"
            />
          ))}
        </div>
      </section>

      <section className="about-section" id="decisions" aria-labelledby="decisions-heading">
        <h2 className="panel__label" id="decisions-heading">
          Key decisions &amp; trade-offs
        </h2>
        <div className="about-decisions">
          {ABOUT_DECISIONS.map((entry) => (
            <DecisionCard
              key={entry.decision}
              decision={entry.decision}
              rationale={entry.rationale}
              tradeoff={entry.tradeoff}
            />
          ))}
        </div>
      </section>

      <section className="about-section" id="limitations" aria-labelledby="limitations-heading">
        <h2 className="panel__label" id="limitations-heading">
          Known limitations
        </h2>
        <p className="about-prose__body">
          These are explicit limitations of the shipped system, not fine print. They explain why the
          roadmap looks the way it does and prevent the page from promising more than the product
          actually delivers today.
        </p>
        <div className="about-note-grid about-note-grid--compact">
          {ABOUT_LIMITATIONS.map((entry) => (
            <AboutNoteCard
              key={entry.title}
              eyebrow={entry.eyebrow}
              title={entry.title}
              body={entry.body}
              tone="warning"
            />
          ))}
        </div>
      </section>

      <section className="about-section" id="scope" aria-labelledby="scope-heading">
        <h2 className="panel__label" id="scope-heading">
          What's deliberately not in v1
        </h2>
        <p className="about-prose__body">
          These exclusions are scoping decisions, not accidental omissions. They keep the first
          version coherent instead of turning it into a grab-bag of adjacent features.
        </p>
        <div className="about-exclusions">
          {ABOUT_EXCLUSIONS.map((entry) => (
            <ExclusionItem key={entry.label} label={entry.label} why={entry.why} />
          ))}
        </div>
      </section>

      <section className="about-section" id="next" aria-labelledby="next-heading">
        <h2 className="panel__label" id="next-heading">
          Possible next steps
        </h2>
        <p className="about-prose__body">
          These are informed directions after v1, not promises. Each one changes cost, consistency,
          or product complexity, so the impact matters as much as the idea itself.
        </p>
        <div className="about-next-grid">
          {ABOUT_NEXT_STEPS.map((entry) => (
            <NextItem
              key={entry.label}
              label={entry.label}
              desc={entry.desc}
              impact={entry.impact}
            />
          ))}
        </div>
      </section>
    </SiteFrame>
  );
}

function AboutNoteCard({
  eyebrow,
  title,
  body,
  aside,
  tone = 'default'
}: Readonly<{
  eyebrow: string;
  title: string;
  body: string;
  aside?: string;
  tone?: 'default' | 'signal' | 'warning';
}>) {
  return (
    <article className={`about-note-card about-note-card--${tone}`}>
      <span className="about-note-card__eyebrow">{eyebrow}</span>
      <strong className="about-note-card__title">{title}</strong>
      <p className="about-note-card__body">{body}</p>
      {aside ? <p className="about-note-card__aside">{aside}</p> : null}
    </article>
  );
}

function FlowStep({
  index,
  label,
  desc
}: Readonly<{ index: string; label: string; desc: string }>) {
  return (
    <div className="about-flow__step">
      <span className="about-flow__index">{index}</span>
      <strong className="about-flow__label">{label}</strong>
      <p className="about-flow__desc">{desc}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="about-flow__arrow" aria-hidden="true">
      <svg width="20" height="12" viewBox="0 0 20 12" fill="none" role="img" aria-label="arrow">
        <path
          d="M0 6h16m0 0l-4-4.5M16 6l-4 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ArchCard({
  kind,
  name,
  purpose,
  detail
}: Readonly<{ kind: 'process' | 'package'; name: string; purpose: string; detail: string }>) {
  return (
    <article className={`about-arch-card about-arch-card--${kind}`}>
      <div className="about-arch-card__head">
        <span className="about-arch-card__kind">{kind === 'process' ? 'Process' : 'Package'}</span>
        <code className="about-arch-card__name">{name}</code>
      </div>
      <strong className="about-arch-card__role">{purpose}</strong>
      <p className="about-arch-card__detail">{detail}</p>
    </article>
  );
}

function StackCard({ tech, why }: Readonly<{ tech: string; why: string }>) {
  return (
    <article className="about-stack-card">
      <strong className="about-stack-card__tech">{tech}</strong>
      <p className="about-stack-card__why">{why}</p>
    </article>
  );
}

function DecisionCard({
  decision,
  rationale,
  tradeoff
}: Readonly<{ decision: string; rationale: string; tradeoff: string }>) {
  return (
    <article className="about-decision-card">
      <strong className="about-decision-card__title">{decision}</strong>
      <p className="about-decision-card__rationale">{rationale}</p>
      <p className="about-decision-card__tradeoff">
        <span className="about-decision-card__tradeoff-label">Trade-off:</span> {tradeoff}
      </p>
    </article>
  );
}

function ExclusionItem({ label, why }: Readonly<{ label: string; why: string }>) {
  return (
    <div className="about-exclusion">
      <strong className="about-exclusion__label">{label}</strong>
      <span className="about-exclusion__why">{why}</span>
    </div>
  );
}

function NextItem({
  label,
  desc,
  impact
}: Readonly<{ label: string; desc: string; impact: string }>) {
  return (
    <article className="about-next-card">
      <strong className="about-next-card__label">{label}</strong>
      <p className="about-next-card__desc">{desc}</p>
      <p className="about-next-card__impact">
        <span className="about-next-card__impact-label">Impact:</span> {impact}
      </p>
    </article>
  );
}

function SupportSection({ support }: Readonly<{ support: AboutSupportConfig }>) {
  if (!support) return null;

  const { address, label, qrValue } = support;

  return (
    <section
      className="panel panel--feature about-support"
      id="support"
      aria-labelledby="support-heading"
    >
      <div className="about-support__header">
        <span className="about-support__eyebrow">Support this project</span>
        <h2 className="about-support__headline" id="support-heading">
          Help keep anonshare online
        </h2>
        <p className="about-prose__body about-support__lede">
          anonshare is a free, non-commercial personal R&amp;D project. If this work has been
          useful, interesting, or worth following, a small tip helps pay for hosting, storage, and
          continued development.
        </p>
      </div>

      <div className="about-support__card">
        <div className="about-support__qr">
          <QRCodeSVG value={qrValue} size={148} bgColor="#f5f4ee" fgColor="#0b0b0d" level="M" />
        </div>
        <div className="about-support__info">
          <span className="about-support__label">{label}</span>
          <WalletAddress address={address} />
          <p className="about-support__note">
            Scan the QR code or copy the wallet address. Every contribution goes directly toward
            keeping the project live and funding future improvements.
          </p>
        </div>
      </div>
    </section>
  );
}

function WalletAddress({ address }: Readonly<{ address: string }>) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const clipboard = globalThis.navigator?.clipboard;

    if (!clipboard) return;

    clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard permission denied — button stays idle, no crash.
      });
  }

  return (
    <div className="about-support__address-row">
      <code className="about-support__address">{address}</code>
      <button
        type="button"
        className="about-support__copy-btn"
        onClick={handleCopy}
        aria-label="Copy wallet address"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 7l3.5 3.5L12 3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect
              x="1"
              y="4"
              width="9"
              height="9"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M4 4V2.5A1.5 1.5 0 015.5 1H11.5A1.5 1.5 0 0113 2.5V8.5A1.5 1.5 0 0111.5 10H10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
