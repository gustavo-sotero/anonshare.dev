import { createFileRoute } from '@tanstack/react-router';
import { getPrivacyHead } from '../legal/privacy-content';
import { PrivacyPage } from '../legal/privacy-page';

export const Route = createFileRoute('/privacy')({
  head: () =>
    getPrivacyHead(
      typeof window === 'undefined' ? process.env.APP_BASE_URL : window.location.origin
    ),
  component: PrivacyPage
});
