export const PRIVACY_PAGE_PATH = '/privacy';
export const PRIVACY_PAGE_TITLE = 'anonshare | Privacy';
export const PRIVACY_PAGE_DESCRIPTION =
  'Privacy information for anonshare — an anonymous file-sharing service. Covers what data is stored, how share links work, reporting, admin access, logging, and data retention.';

const DEFAULT_PRIVACY_BASE_URL = 'http://localhost:3000';

export const PRIVACY_HERO = {
  eyebrow: 'Legal',
  title: 'Privacy',
  summary:
    'What anonshare stores, processes, and retains — written to reflect what the system actually does, not what a generic privacy policy template says.'
};

export type PrivacySection = {
  id: string;
  heading: string;
  content: string[];
};

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: 'model',
    heading: 'Anonymous by design',
    content: [
      'anonshare is designed around anonymous file sharing. There are no user accounts, no registration, and no tracking cookies. Uploaders and recipients do not need to identify themselves to use the service.',
      'This is a non-commercial personal R&D project. It is not operated by a company. Data minimization is a design goal — the system collects only what is necessary to operate the file-sharing flow and moderate abuse.'
    ]
  },
  {
    id: 'stored-data',
    heading: 'What is stored',
    content: [
      'When you upload a file, the service stores the file object in S3-compatible storage, and a metadata record in PostgreSQL containing: filename, MIME type, size in bytes, upload rules (one-time, expiration, allow preview), upload timestamp, status, and a share token.',
      'The share token is a randomly generated unguessable string. It is not derived from your identity, IP address, timestamp, or any predictable source.',
      'Download events are recorded per file as counters. The system does not tie individual download events to a visitor identity or IP address in the application database.',
      "Files and their metadata are deleted at or after the configured expiration time by background cleanup jobs. Files without an explicit expiration may be retained at the operator's discretion and are subject to lifecycle cleanup."
    ]
  },
  {
    id: 'share-links',
    heading: 'Share links and public access',
    content: [
      'Share links are public by design. Anyone with the link can access the associated file while it is valid. The only access control is possession of the token — there is no per-recipient access list.',
      'Share pages are marked noindex and nofollow so they are not indexed by search engines. However, the link itself is not a secret beyond being hard to guess. Anyone with the link can share it further.',
      'For one-time links, access is revoked after the first successful download. Visiting a consumed one-time link returns an unavailable state without revealing what the file contained.'
    ]
  },
  {
    id: 'reports',
    heading: 'Reports',
    content: [
      'Recipients can submit a report from the public file page. A report captures a reason category and an optional free-text message provided by the reporter.',
      'Report content — including any optional free-text — is visible to the operator during moderation review. Do not include personal or sensitive information in a report message.',
      'Reports are stored in the database and are reviewed by the operator. They are not shared with third parties.'
    ]
  },
  {
    id: 'admin',
    heading: 'Administrator access',
    content: [
      'There is exactly one administrator, identified by a specific allowlisted GitHub account. Admin authentication uses GitHub OAuth. Non-allowlisted GitHub accounts cannot access the admin dashboard.',
      'The administrator can view files, download counts, storage state, reports, and operational anomalies. They can hide, restore, or delete files and resolve reports.',
      "GitHub OAuth is provided by GitHub, Inc. Review GitHub's privacy policy for details on what GitHub collects during the OAuth flow."
    ]
  },
  {
    id: 'logging',
    heading: 'Operational logs',
    content: [
      'The service emits structured operational logs for events such as upload creation, download initiation, report submission, and lifecycle operations. These logs are used for monitoring and abuse detection.',
      'Rate-limiting controls may process IP addresses transiently at the infrastructure level to enforce request limits. IP data is not permanently stored in the application database.',
      'Logs are not used for advertising, behavioral profiling, or third-party analytics.'
    ]
  },
  {
    id: 'retention',
    heading: 'Retention and deletion',
    content: [
      'Files are deleted at or after their configured expiration time by background jobs. A reconciliation process also identifies and removes orphaned or inconsistent records.',
      'Deleted and expired files cannot be recovered. Do not use anonshare as a long-term file storage solution — it is designed for short-lived ephemeral sharing.',
      'Report records may be retained for operator reference after the associated file is deleted.'
    ]
  },
  {
    id: 'contact',
    heading: 'Contact',
    content: [
      'anonshare is a personal project operated by Gustavo Sotero. For questions or concerns, you can reach the operator through the GitHub repository linked in the footer.'
    ]
  }
];

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_PRIVACY_BASE_URL).replace(/\/+$/, '');
}

export function getPrivacyUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}${PRIVACY_PAGE_PATH}`;
}

export function getPrivacyHead(baseUrl?: string) {
  const url = getPrivacyUrl(baseUrl);

  return {
    meta: [
      { title: PRIVACY_PAGE_TITLE },
      { name: 'description', content: PRIVACY_PAGE_DESCRIPTION },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'anonshare' },
      { property: 'og:title', content: PRIVACY_PAGE_TITLE },
      { property: 'og:description', content: PRIVACY_PAGE_DESCRIPTION },
      { property: 'og:url', content: url }
    ],
    links: [{ rel: 'canonical', href: url }]
  };
}
