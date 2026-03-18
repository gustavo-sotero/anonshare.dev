import { createFileRoute } from '@tanstack/react-router';
import { getAboutHead } from '../about/content';
import { AboutPage } from '../about/page';

export const Route = createFileRoute('/about')({
  head: () =>
    getAboutHead(typeof window === 'undefined' ? process.env.APP_BASE_URL : window.location.origin),
  component: AboutPage
});
