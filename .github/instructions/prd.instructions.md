---
description: PRD
applyTo: '**'
---
## PRD: anonshare.dev

## 1. Product overview

### 1.1 Document title and version

- PRD: anonshare.dev
- Version: 0.1.0

### 1.2 Product summary

anonshare.dev is an anonymous file-sharing web application built for research, development, and portfolio use. A visitor can open the site, upload a file without creating an account, define rules such as one-time download and expiration, and receive a shareable link. Recipients can access a dedicated file page, download the file when it is still valid, and optionally preview supported content types when the uploader allowed preview.

The project is intentionally non-commercial and should emphasize strong product thinking, modern architecture, and operational control rather than feature breadth. In addition to the public sharing flow, the application will include an admin dashboard protected by GitHub login for a single allowlisted administrator, plus a dedicated page explaining the project itself, including architecture, stack, decisions, and trade-offs for portfolio presentation.

## 2. Goals

### 2.1 Business goals

- Build a portfolio-grade product that demonstrates full-stack architecture, product thinking, and operational maturity.
- Validate a Bun-first stack in a realistic application with storage, jobs, caching, and moderation flows.
- Publish a polished public project page that explains technical decisions and trade-offs clearly.
- Keep running costs and operational complexity low enough for a personal non-commercial project.

### 2.2 User goals

- Upload a file quickly without creating an account.
- Choose clear sharing rules before upload, especially one-time download, expiration, and preview behavior.
- Receive a shareable link immediately after a successful upload.
- Open a link and download or preview the file when access is still valid.
- Report suspicious or abusive files from the public file page.
- Administer all files, reports, downloads, and storage from a single dashboard.

### 2.3 Non-goals

- Multi-user uploader accounts.
- Commercial billing, subscriptions, or payment flows.
- Collaboration features such as folders, comments, or shared workspaces.
- Multi-admin support in v1.
- Advanced compliance features such as legal hold, regional residency controls, or enterprise audit exports.
- Malware scanning, end-to-end encryption, or password-protected shares in v1.

## 3. User personas

### 3.1 Key user types

- Anonymous uploader
- Recipient/downloader
- Administrator
- Portfolio reviewer

### 3.2 Basic persona details

- **Anonymous uploader**: Wants to share a file quickly without onboarding friction and with minimal exposure of personal information.
- **Recipient/downloader**: Receives a link and expects a fast, trustworthy, and clear download or preview experience.
- **Administrator**: Sole operator of the project, responsible for moderation, storage oversight, reports, and platform health.
- **Portfolio reviewer**: Recruiter, hiring manager, or peer who wants to understand what the project does and why the technical choices matter.

### 3.3 Role-based access

- **Anonymous uploader**: Can upload a file, configure sharing rules, and obtain a share link. Has no persistent account or dashboard access.
- **Recipient/downloader**: Can view a valid share page, preview eligible files when enabled, download the file, and submit a report.
- **Administrator**: Can sign in with GitHub if and only if the GitHub account matches the allowlisted identity, then view and manage files, reports, downloads, storage, and moderation states.
- **Portfolio reviewer**: Can read the public project/about page without authentication.

## 4. Functional requirements

- **Anonymous upload flow** (Priority: P0)

  - The application must let a visitor select or drag-and-drop a file up to 256 MB.
  - The application must collect upload options before submission: one-time download, expiration, and allow preview.
  - The expiration selector must support a maximum retention window of 30 days.
  - The backend must validate file size, MIME type, and configured options server-side.
  - A successful upload must create a database record, store the object in S3-compatible storage, and return an unguessable share URL.

- **Share page and download flow** (Priority: P0)

  - Each uploaded file must have a dedicated public page addressed by a tokenized share link.
  - The public page must show essential metadata such as filename, file size, type, and availability state.
  - The system must prevent access when the file is expired, deleted, hidden by moderation, or already consumed as a one-time download.
  - The user must be able to download the file from the public page when the file is still active.

- **Preview experience** (Priority: P1)

  - The public page must support in-browser preview for eligible file types such as images, video, audio, PDF, and plain text.
  - Preview must only be available when the uploader explicitly enabled preview.
  - Preview must be disabled for one-time download files to preserve single-consumption semantics.

- **Expiration and lifecycle management** (Priority: P0)

  - The system must store an explicit expiration timestamp when expiration is configured.
  - Expired files must become inaccessible immediately at the application level.
  - Background jobs must delete or clean up expired objects and update their metadata state.
  - A reconciliation process must exist to recover from missed cleanup jobs and remove orphaned data safely.

- **Reporting and moderation** (Priority: P0)

  - The public file page must allow users to report a file.
  - The report flow must capture at least a reason category and optional free-text context.
  - Files must be automatically hidden from public access after reaching a configurable report threshold.
  - Hidden files must remain visible to the admin for review and action.

- **Admin dashboard and access control** (Priority: P0)

  - The admin dashboard must support GitHub login for exactly one allowlisted administrator.
  - The admin must be able to view total files, active files, expired files, downloads, storage usage, reports, and queue health.
  - The admin must be able to inspect individual files, reports, and download activity.
  - The admin must be able to hide, restore, delete, or otherwise moderate files and resolve reports.

- **Project/about page** (Priority: P1)

  - The application must include a dedicated public page explaining the project.
  - The page must describe the purpose, stack, architecture, major decisions, trade-offs, and research/portfolio goals.
  - The page should make the project understandable to both technical and non-technical reviewers.

- **Abuse prevention and observability** (Priority: P1)

  - The platform must implement rate limiting for upload, download, and report actions.
  - The system must emit structured logs for critical events such as upload created, download started, download completed, report created, file hidden, and file deleted.
  - Share pages should not be indexed by search engines.

## 5. User experience

### 5.1 Entry points & first-time user flow

- Visitor lands on the home page and immediately sees the anonymous upload value proposition.
- Visitor selects a file, configures one-time download, expiration, and preview, then starts upload.
- After upload succeeds, the app shows the share link with quick actions to copy and open it.
- Recipient opens the link, sees the file page, and can preview or download when policy allows.
- Any visitor can navigate to the dedicated project/about page to understand the product and technical choices.
- The administrator signs in through GitHub and lands on an operational dashboard.

### 5.2 Core experience

- **Upload and configure**: The upload form must keep the flow short and understandable, with clear labels for expiration, one-time download, and preview so the user can make a decision before sending the file.

  - This ensures a low-friction anonymous experience without hiding important policy choices.

- **Share and consume**: The generated link must lead to a clean file page that clearly communicates whether the file can be previewed, downloaded, or has become unavailable.

  - This reduces confusion and prevents recipients from guessing why access failed.

- **Moderate and operate**: The admin dashboard must present system health and content risk in one place, with direct actions for reports and storage cleanup.

  - This keeps the project manageable for a single operator.

### 5.3 Advanced features & edge cases

- Unsupported file types must still be downloadable even when preview is unavailable.
- A one-time file must show a clear unavailable state after a successful first download.
- Expired files must show an explicit expiration message rather than a generic 404 page.
- Files hidden by automatic moderation must not be previewable or downloadable publicly.
- Interrupted or failed uploads must not leave active database records pointing to missing objects.
- Missing S3 objects must be surfaced as operational issues in the admin area or logs.
- Repeated report spam must be rate-limited.

### 5.4 UI/UX highlights

- Minimal, fast public flow with upload first and no account prompts.
- Clear status badges for active, expiring, expired, hidden, deleted, and one-time consumed states.
- Strong separation between preview and download actions so users understand what will happen.
- Responsive admin interface with dense but readable operational tables and summary cards.
- Dedicated about page that feels intentional and portfolio-ready rather than secondary documentation.

## 6. Narrative

The project should feel immediate for the uploader, dependable for the recipient, and controlled for the administrator. A user arrives, uploads a file, defines exactly how it should behave, and receives a link with almost no friction. The recipient sees a clear public page that respects those rules, while the admin can monitor abuse, storage, downloads, and lifecycle events from one place. Separately, the about page turns the application into a portfolio artifact by making the reasoning behind the system visible.

## 7. Success metrics

### 7.1 User-centric metrics

- Median time from landing on the home page to copying a share link under 60 seconds.
- Upload success rate above 95% for files within the supported size limit.
- Download page load time under 1.5 seconds at p95 for cached public metadata responses.
- At least 85% of valid share-link visits result in a successful download or preview session.
- Report submission flow completed in under 30 seconds.

### 7.2 Business metrics

- The project is production-deployed and portfolio-ready by the end of the planned delivery window.
- The about page clearly documents the architecture, stack, and trade-offs in a way suitable for interviews and portfolio review.
- Ongoing infrastructure cost remains within a personal hobby budget.
- Manual report review can be completed by the sole admin in under 24 hours for normal volume.

### 7.3 Technical metrics

- Expiration and cleanup jobs succeed above 99% without manual intervention.
- Queue lag for normal operational jobs stays under 60 seconds.
- Zero unauthorized access to admin routes from non-allowlisted GitHub accounts.
- Zero public access to files that are expired, hidden, deleted, or already consumed as one-time downloads.
- Reconciliation jobs detect and resolve orphaned metadata or storage objects within 24 hours.

## 8. Technical considerations

### 8.1 Integration points

- Bun workspaces should be used for the monorepo. Turborepo should not be introduced in v1 unless build or workspace complexity proves it necessary later.
- TanStack Start should power the public site, admin shell, route structure, SSR-capable pages, and the project/about page.
- Hono should provide the API surface for upload, download, report, admin, and internal operational endpoints.
- PostgreSQL should store file metadata, report records, download events, admin sessions, and operational states.
- Bun SQL should serve as the PostgreSQL driver, with Drizzle ORM handling schema modeling and migrations.
- Redis should back caching, rate limiting, and BullMQ queue state.
- BullMQ should handle delayed expiration, cleanup, reconciliation, and moderation-related jobs.
- S3-compatible object storage should be accessed through Bun's native S3 API, with AWS S3 and Cloudflare R2 as primary targets.
- GitHub OAuth should handle administrator authentication, with a strict allowlist for one GitHub identity.
- Docker Compose should provide local PostgreSQL, Redis, and an S3-compatible local development service such as MinIO.

### 8.2 Data storage & privacy

- Store file metadata separately from file objects, including token, object key, sanitized filename, MIME type, size, status, upload rules, and timestamps.
- Store report records with reason, optional message, status, and moderation outcome.
- Store download events and counters for analytics and one-time download enforcement.
- Minimize personal data collection for anonymous users. If IP-based abuse protection is needed, prefer hashed or truncated representations with defined retention.
- Avoid exposing uploader identity because uploads are anonymous by design.
- Mark public share pages with noindex directives to reduce accidental search indexing.
- Use HTTPS for all environments beyond local development, and rely on provider-side encryption at rest where available.

### 8.3 Scalability & performance

- Prefer direct-to-S3 uploads with presigned PUT URLs for production to avoid routing large file bodies through the application server.
- If server-mediated uploads are supported, Bun and Hono request body limits must be explicitly configured above the chosen file-size limit.
- Use object storage or presigned delivery for standard downloads and previews to reduce backend bandwidth usage.
- Keep one-time downloads on a controlled backend path when necessary to guarantee atomic access invalidation and avoid race conditions.
- Add indexes for token lookup, status filtering, expiration queries, report counts, and recent admin views.
- Use Redis-backed throttling for uploads, reports, and repeated link access attempts.
- Include a scheduled reconciliation job because delayed queues alone are not sufficient as the only lifecycle guarantee.

### 8.4 Potential challenges

- Anonymous file sharing introduces abuse and moderation risk even for a non-commercial portfolio project.
- One-time download semantics are difficult to guarantee if delivery is fully delegated to blind presigned URLs, especially around retries and partial transfers.
- Preview support varies by browser and MIME type, so supported formats must be clearly scoped.
- Bun SQL and Drizzle integration must be standardized early to avoid migration or typing inconsistency.
- GitHub authentication for a single admin must enforce allowlisting by a stable GitHub identifier, not only a display name.
- Auto-hiding files after a report threshold can reduce abuse exposure, but false positives must be reversible from the admin dashboard.

## 9. Milestones & sequencing

### 9.1 Project estimate

- Medium: 6 to 8 weeks part-time for a polished solo portfolio delivery.

### 9.2 Team size & composition

- 1 person: product, design, frontend, backend, database, infrastructure, QA, and operations.

### 9.3 Suggested phases

- **Phase 1**: Foundation and architecture setup (1 to 1.5 weeks)

  - Key deliverables: Monorepo structure with Bun workspaces, local Docker Compose stack, base TanStack Start app, Hono API skeleton, PostgreSQL schema design, Redis and BullMQ wiring, GitHub auth design.

- **Phase 2**: Public upload, share, download, and preview flows (2 to 2.5 weeks)

  - Key deliverables: Anonymous upload UX, storage integration, share token generation, public file page, download flow, preview flow, one-time download enforcement, expiration model.

- **Phase 3**: Moderation, dashboard, and operational controls (1.5 to 2 weeks)

  - Key deliverables: GitHub admin authentication, dashboard metrics, file/report management, auto-hide thresholds, download event visibility, lifecycle jobs, reconciliation jobs.

- **Phase 4**: Portfolio polish, testing, and deployment (1.5 to 2 weeks)

  - Key deliverables: About page, responsive UI refinement, logging and rate limiting, test coverage for critical flows, deployment setup, documentation, and production hardening.

## 10. User stories

### 10.1 Create an anonymous upload

- **ID**: GH-001
- **Description**: As an anonymous visitor, I want to upload a file without creating an account so that I can share it quickly.
- **Acceptance criteria**:

  - The home page provides a visible file picker or drag-and-drop area.
  - The system rejects files larger than 256 MB before final processing.
  - The system creates a pending upload only when the selected file passes validation.
  - A successful upload stores the file and creates a metadata record.

### 10.2 Configure file behavior before upload

- **ID**: GH-002
- **Description**: As an anonymous visitor, I want to define one-time download, expiration, and preview behavior before upload so that the share link behaves the way I expect.
- **Acceptance criteria**:

  - The upload flow exposes controls for one-time download, expiration, and allow preview.
  - Expiration options do not allow values beyond 30 days.
  - The backend validates all selected options and rejects invalid combinations.
  - Preview cannot remain enabled when one-time download is enabled.

### 10.3 Receive a shareable link after upload

- **ID**: GH-003
- **Description**: As an anonymous visitor, I want to receive a shareable link immediately after a successful upload so that I can send it to someone else.
- **Acceptance criteria**:

  - After upload completes, the UI shows the generated share URL.
  - The share URL can be copied with one user action.
  - The token in the share URL is not predictable from sequence or timestamp alone.
  - The same page offers a direct way to open the generated link.

### 10.4 Access a valid public file page

- **ID**: GH-004
- **Description**: As a recipient, I want to open a share link and see the file status so that I know whether I can access the file.
- **Acceptance criteria**:

  - A valid link opens a dedicated file page.
  - The page shows filename, size, and file type.
  - The page shows a clear unavailable state if the file is expired, hidden, deleted, or already consumed.
  - The page never exposes uploader identity.

### 10.5 Preview supported files when allowed

- **ID**: GH-005
- **Description**: As a recipient, I want to preview supported files in the browser when the uploader allowed it so that I can inspect content before downloading.
- **Acceptance criteria**:

  - Preview is shown only for supported MIME types.
  - Preview is shown only when allow preview was enabled at upload time.
  - One-time download files do not expose preview.
  - When preview is unavailable, the UI still offers download if the file remains valid.

### 10.6 Consume a one-time download safely

- **ID**: GH-006
- **Description**: As a recipient, I want one-time download links to stop working after one successful download so that the uploader's restriction is respected.
- **Acceptance criteria**:

  - A one-time file can be downloaded exactly once.
  - After a successful first download, the file status changes to consumed.
  - Subsequent visits to the same link show a clear consumed state.
  - The system prevents race conditions that would allow multiple successful downloads from concurrent requests.

### 10.7 Enforce expiration and cleanup

- **ID**: GH-007
- **Description**: As the system operator, I want expired files to become inaccessible and be cleaned up automatically so that storage and policy remain consistent.
- **Acceptance criteria**:

  - Expired files are blocked from public access at the expiration time.
  - A background job updates the metadata state for expired files.
  - A cleanup process deletes or archives the corresponding object according to the defined lifecycle rule.
  - A reconciliation job can identify and fix inconsistent records or storage leftovers.

### 10.8 Report an abusive or suspicious file

- **ID**: GH-008
- **Description**: As a recipient or visitor, I want to report a file from the public page so that suspicious content can be reviewed.
- **Acceptance criteria**:

  - The public file page exposes a report action.
  - The report form captures a reason and optional extra context.
  - Repeated report submissions from the same source are rate-limited.
  - When a file reaches the configured report threshold, it becomes hidden from public access automatically.

### 10.9 Sign in to the admin dashboard securely

- **ID**: GH-009
- **Description**: As the administrator, I want to sign in with GitHub and be blocked unless I am the allowlisted account so that admin access remains restricted.
- **Acceptance criteria**:

  - Admin authentication uses GitHub OAuth.
  - Only the configured GitHub account can complete sign-in.
  - Non-allowlisted GitHub accounts are denied dashboard access.
  - Protected admin routes require a valid authenticated session.

### 10.10 View platform health and usage

- **ID**: GH-010
- **Description**: As the administrator, I want a dashboard overview of files, downloads, storage, reports, and job health so that I can understand system status quickly.
- **Acceptance criteria**:

  - The dashboard shows counts for total files, active files, expired files, hidden files, and deleted files.
  - The dashboard shows download volume and storage usage.
  - The dashboard shows report counts and unresolved reports.
  - The dashboard shows background queue or worker health indicators.

### 10.11 Moderate files and resolve reports

- **ID**: GH-011
- **Description**: As the administrator, I want to manage files and reports from the dashboard so that I can respond to abuse and operational issues.
- **Acceptance criteria**:

  - The admin can view a list of files with filters by state.
  - The admin can open report details and mark them resolved or dismissed.
  - The admin can hide, restore, or delete a file.
  - Admin actions are reflected in public link availability immediately when relevant.

### 10.12 Inspect download and storage activity

- **ID**: GH-012
- **Description**: As the administrator, I want to inspect download activity and storage consumption so that I can manage capacity and investigate anomalies.
- **Acceptance criteria**:

  - The admin can see per-file download counts.
  - The admin can see file size and current storage state for each file.
  - The admin can identify files contributing most to storage usage.
  - Missing-object or inconsistent-state records are visible as operational anomalies.

### 10.13 Understand the project itself

- **ID**: GH-013
- **Description**: As a portfolio reviewer, I want a dedicated page explaining how the project works so that I can evaluate the product and technical thinking behind it.
- **Acceptance criteria**:

  - The application includes a public project/about page.
  - The page explains the problem, intended audience, and non-commercial R&D purpose.
  - The page lists the main stack choices and why they were selected.
  - The page documents key trade-offs, limitations, and future improvements.