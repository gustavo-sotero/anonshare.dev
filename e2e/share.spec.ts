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
 */
test('expired share link shows unavailable state', async ({ page }) => {
  // Upload with a very short expiration
  const { shareUrl } = await uploadFile({
    filename: 'expiring.txt',
    content: 'Expiring soon',
    expiresInMinutes: -1 // already expired
  });

  await page.goto(shareUrl);

  // Should not show the file as downloadable; should show some unavailable indicator
  await expect(
    page.locator(
      '[data-testid="unavailable"], :text("no longer available"), :text("expired"), :text("not available")'
    )
  ).toBeVisible({ timeout: 10_000 });
});
