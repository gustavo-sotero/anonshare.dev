import { createFileRoute } from '@tanstack/react-router';
import { getTermsHead } from '../legal/terms-content';
import { TermsPage } from '../legal/terms-page';

export const Route = createFileRoute('/terms')({
  head: () =>
    getTermsHead(typeof window === 'undefined' ? process.env.APP_BASE_URL : window.location.origin),
  component: TermsPage
});
