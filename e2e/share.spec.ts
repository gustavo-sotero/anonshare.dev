import { expect, test } from '@playwright/test';
import { API_URL, uploadFile } from './helpers';

/**
 * Happy path: upload a file, receive a share URL, visit it, and download.
 */
test('upload → share → download happy path', async ({ page }) => {
  await page.goto('/');

  // The upload form must be visible on the home page
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();

  // Upload a plain-text file through the browser UI
  await fileInput.setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Hello E2E world')
  });

  // Trigger the upload — file selection alone does not start the upload
  await page.getByRole('button', { name: 'Upload and generate link' }).click();

  // The share URL should appear after a successful upload
  const shareLink = page.locator('[data-testid="share-link"], a[href*="/share/"]').first();
  await expect(shareLink).toBeVisible({ timeout: 15_000 });

  const href = await shareLink.getAttribute('href');
  expect(href).toMatch(/\/share\/[A-Za-z0-9_-]{16,}/);

  // Navigate to the share page
  await page.goto(href ?? '');

  // The file page should show the filename and a download action
  await expect(page.getByText('hello.txt', { exact: false })).toBeVisible();
  const downloadAction = page.locator(
    'a[href*="/download"], button:has-text("Download"), a:has-text("Download")'
  );
  await expect(downloadAction.first()).toBeVisible();
});

/**
 * Preview-enabled files expose an inline preview without suppressing download.
 */
test('preview-enabled share shows preview and download actions together', async ({ page }) => {
  const { shareUrl } = await uploadFile({
    filename: 'previewable.txt',
    content: 'Preview me in the browser',
    allowPreview: true
  });

  await page.goto(shareUrl);

  await expect(page.getByText('previewable.txt', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download file' })).toBeVisible();

  await page.getByRole('button', { name: 'Load preview' }).click();

  await expect(page.getByText('Preview me in the browser')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Download file' })).toBeVisible();
});

/**
 * One-time download: file is consumed after the first download and the share
 * page shows an unavailable state on subsequent visits.
 */
test('one-time download is consumed after first access', async ({ page }) => {
  // Use the API directly to avoid UI rate limiting in CI
  const { shareUrl } = await uploadFile({
    filename: 'one-time.txt',
    content: 'One time only',
    oneTimeDownload: true
  });

  // First visit: file should be accessible
  await page.goto(shareUrl);
  await expect(page.getByText('one-time.txt', { exact: false })).toBeVisible();

  // Trigger the download via the API directly to mark the file as consumed
  const token = shareUrl.split('/share/')[1];
  const downloadResponse = await page.request.get(`${API_URL}/share/${token}/download`);
  expect([200, 302]).toContain(downloadResponse.status());

  // Second visit: file should show consumed/unavailable state
  await page.goto(shareUrl);
  await expect(
    page.locator('[data-testid="unavailable"], :text("no longer available"), :text("consumed")')
  ).toBeVisible({ timeout: 10_000 });
});

/**
 * Expired file: visiting an expired share link shows an explicit expiration message.
 *
 * Uses the test-only POST /_internal/test/expire/:token endpoint to force-expire the
 * file immediately, avoiding any timing dependency. This is safe because the endpoint
 * is guarded server-side and only active when APP_ENV=test.
 */
test('expired share link shows unavailable state', async ({ page }) => {
  const { shareToken, shareUrl } = await uploadFile({
    filename: 'expiring.txt',
    content: 'Expiring soon'
  });

  // Force-expire the file via the test helper endpoint
  const expireResponse = await page.request.post(`${API_URL}/_internal/test/expire/${shareToken}`);
  expect(expireResponse.ok()).toBe(true);

  await page.goto(shareUrl);

  // Should not show the file as downloadable; should show some unavailable indicator
  await expect(
    page.locator(
      '[data-testid="unavailable"], :text("no longer available"), :text("expired"), :text("not available")'
    )
  ).toBeVisible({ timeout: 10_000 });
});

/**
 * Repeated public reports should auto-hide the file once the threshold is met.
 */
test('report submissions auto-hide a file after the threshold is reached', async ({ page }) => {
  const { shareUrl } = await uploadFile({
    filename: 'report-target.txt',
    content: 'This file will be auto-hidden after reports'
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(shareUrl);

    await page.getByRole('button', { name: 'report it' }).click();
    await page.getByLabel('Reason').selectOption('spam');
    await page.getByLabel('Additional context (optional)').fill(`report attempt ${attempt}`);
    await page.getByRole('button', { name: 'Submit report' }).click();

    if (attempt < 3) {
      await expect(page.getByText('Your report has been received.')).toBeVisible({
        timeout: 10_000
      });
    }
  }

  await expect(page.getByText('This file is not available.')).toBeVisible({ timeout: 10_000 });
});
