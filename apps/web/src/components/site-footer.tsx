import { Link } from '@tanstack/react-router';

const EXTERNAL_LINKS = [
  { label: 'Repo', href: 'https://github.com/gsotero/anonshare.dev' },
  { label: 'GitHub', href: 'https://github.com/gsotero' },
  { label: 'Portfólio', href: 'https://gsotero.dev' }
];

const PAGE_LINKS = [
  { label: 'About', to: '/about' as const },
  { label: 'Terms', to: '/terms' as const },
  { label: 'Privacy', to: '/privacy' as const }
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="site-footer__tagline">
          anonshare — anonymous file sharing. no accounts. no trace.
        </p>
        <nav className="site-footer__credits" aria-label="Footer pages">
          {PAGE_LINKS.map((link, index) => (
            <span key={link.label}>
              {index > 0 && <span className="site-footer__sep">·</span>}
              <Link to={link.to} className="site-footer__link">
                {link.label}
              </Link>
            </span>
          ))}
        </nav>
        <div className="site-footer__credits">
          <span className="site-footer__credit-label">Feito por Gustavo Sotero</span>
          {EXTERNAL_LINKS.map((link) => (
            <span key={link.label}>
              <span className="site-footer__sep">·</span>
              <a
                href={link.href}
                className="site-footer__link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
