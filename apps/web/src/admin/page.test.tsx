import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPage } from './page';

describe('AdminPage SSR', () => {
  it('renders the branded admin login gate without the public site frame', () => {
    const html = renderToStaticMarkup(
      <AdminPage
        loaderData={{
          initialState: { kind: 'unauthenticated' },
          loginError: null
        }}
      />
    );

    expect(html).toContain('admin-login-card__brand');
    expect(html).toContain('anonshare');
    expect(html).toContain('Admin access');
    expect(html).toContain('Sign in to continue.');
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain(
      'The operations dashboard requires authentication with the allowlisted GitHub account.'
    );
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).not.toContain('Share a file');
  });
});
