export const TERMS_PAGE_PATH = '/terms';
export const TERMS_PAGE_TITLE = 'anonshare | Terms of Use';
export const TERMS_PAGE_DESCRIPTION =
  'Terms of use for anonshare — an anonymous file-sharing service built as personal R&D. Covers upload rules, access semantics, moderation, service limitations, and prohibited use.';

const DEFAULT_TERMS_BASE_URL = 'http://localhost:3000';

export const TERMS_HERO = {
  eyebrow: 'Legal',
  title: 'Terms of Use',
  summary:
    'Rules and expectations for using anonshare. The service is non-commercial and personal in nature — these terms reflect that honestly rather than copying a generic SaaS template.'
};

export type TermsSection = {
  id: string;
  heading: string;
  content: string[];
};

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: 'service',
    heading: 'What this service is',
    content: [
      'anonshare is a non-commercial personal R&D project operated by one person. It is not a commercial product and does not have a service-level agreement, uptime guarantee, or dedicated support.',
      'By using anonshare you acknowledge that it is an experimental, best-effort service. Files may be unavailable, removed, or lost under normal operating conditions, and the service may be discontinued at any time without notice.'
    ]
  },
  {
    id: 'uploads',
    heading: 'Uploads and your responsibility',
    content: [
      'Uploads are anonymous. You do not need an account. The service stores file content and metadata but does not link personal identity to uploads.',
      'You are solely responsible for the content you upload. You must not upload files that are illegal, infringe on third-party rights, contain malware, or otherwise violate applicable law.',
      'By uploading a file you confirm that you have the right to share it and that it does not violate these terms.'
    ]
  },
  {
    id: 'access-rules',
    heading: 'Access rules and expiration',
    content: [
      'anonshare enforces the access rules set at upload time: one-time download, time-based expiration, and optional in-browser preview.',
      'One-time links become permanently inaccessible after a single successful download. This is enforced server-side to prevent race conditions from allowing multiple concurrent downloads.',
      'Files expire at or after the configured expiration time and are then deleted. Expired files cannot be recovered. Do not rely on anonshare as a permanent or long-term storage solution.',
      "The maximum supported retention window is 30 days from upload. Files without an explicit expiration may still be subject to lifecycle cleanup at the operator's discretion."
    ]
  },
  {
    id: 'moderation',
    heading: 'Moderation and removal',
    content: [
      'Recipients can report files from the public file page. Reports include a reason category and an optional free-text message, and are reviewed by the operator.',
      'Files that receive reports above a configurable threshold are automatically hidden from public access as a precautionary measure. Automatic hiding can be reviewed and reversed by the operator.',
      'The operator reserves the right to hide, delete, or otherwise moderate any file at any time without prior notice.',
      'Moderation is operated by one person and is not real-time. There is no guarantee of review within any specific timeframe or volume.'
    ]
  },
  {
    id: 'preview',
    heading: 'Preview support',
    content: [
      'In-browser preview is available only when the uploader explicitly enabled it at upload time, and only for supported MIME types: images, video, audio, PDF, and plain text.',
      'Preview is never available for one-time download files, because exposing the content before the download would undermine single-consumption semantics.',
      'The service may truncate or fail to preview very large files or unsupported subtypes within those categories.'
    ]
  },
  {
    id: 'prohibited',
    heading: 'Prohibited use',
    content: [
      'You must not upload, store, or distribute illegal content — including but not limited to content that infringes copyright, constitutes child sexual abuse material, or facilitates criminal activity.',
      'You must not use the service to distribute malware, phishing payloads, or other harmful software.',
      'You must not attempt to abuse the service through automated upload loops, denial-of-service attacks, or systematic circumvention of rate limiting or access controls.',
      'Violations may result in removal of your files and restriction of access to the service.'
    ]
  },
  {
    id: 'availability',
    heading: 'Service availability and liability',
    content: [
      'anonshare is a personal non-commercial project with no service-level agreement. The service may be slow, unavailable, or discontinued at any time.',
      'The operator is not liable for data loss, inaccessibility, or any consequence arising from use of the service.',
      'Files may be deleted as a result of infrastructure maintenance, storage cleanup, or operator action without warning.'
    ]
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    content: [
      'These terms may be updated at any time. The most recent version is always published at this URL.',
      'Continued use of the service after any update constitutes acceptance of the revised terms.'
    ]
  }
];

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_TERMS_BASE_URL).replace(/\/+$/, '');
}

export function getTermsUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}${TERMS_PAGE_PATH}`;
}

export function getTermsHead(baseUrl?: string) {
  const url = getTermsUrl(baseUrl);

  return {
    meta: [
      { title: TERMS_PAGE_TITLE },
      { name: 'description', content: TERMS_PAGE_DESCRIPTION },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'anonshare' },
      { property: 'og:title', content: TERMS_PAGE_TITLE },
      { property: 'og:description', content: TERMS_PAGE_DESCRIPTION },
      { property: 'og:url', content: url }
    ],
    links: [{ rel: 'canonical', href: url }]
  };
}
