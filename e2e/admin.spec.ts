import { expect, test } from '@playwright/test';
import { API_URL, BASE_URL, bootstrapAdminSession, uploadFile } from './helpers';

/**
 * Admin hide/restore affects public visibility.
 *
 * This test bootstraps an admin session using the test-only internal endpoint
 * (available only when NODE_ENV=test), performs a moderation action via the
 * API, and verifies the public share page reflects the hidden state.
 */
test('admin hide makes file unavailable on share page', async ({ page }) => {
  // Upload a file to moderate
  const { shareToken, shareUrl } = await uploadFile({
    filename: 'to-hide.txt',
    content: 'This file will be hidden'
  });

  // Verify the file is accessible before hiding
  await page.goto(shareUrl);
  await expect(page.getByText('to-hide.txt', { exact: false })).toBeVisible();

  // Bootstrap an admin session for the API
  const adminCookie = await bootstrapAdminSession();

  // Hide the file via the admin API
  const hideResponse = await page.request.post(`${API_URL}/admin/files/${shareToken}/moderate`, {
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie
    },
    data: { action: 'hide' }
  });
  expect(hideResponse.ok()).toBe(true);

  // The share page should now show unavailable state
  await page.goto(shareUrl);
  await expect(
    page.locator(
      '[data-testid="unavailable"], :text("no longer available"), :text("hidden"), :text("not available")'
    )
  ).toBeVisible({ timeout: 10_000 });
});

/**
 * Admin restore makes a previously hidden file accessible again.
 */
test('admin restore makes hidden file accessible again', async ({ page }) => {
  const { shareToken, shareUrl } = await uploadFile({
    filename: 'to-restore.txt',
    content: 'This file will be hidden then restored'
  });

  const adminCookie = await bootstrapAdminSession();

  // Hide first
  await page.request.post(`${API_URL}/admin/files/${shareToken}/moderate`, {
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    data: { action: 'hide' }
  });

  // Verify hidden
  await page.goto(shareUrl);
  await expect(
    page.locator(':text("no longer available"), :text("hidden"), :text("not available")')
  ).toBeVisible({ timeout: 10_000 });

  // Restore
  const restoreResponse = await page.request.post(`${API_URL}/admin/files/${shareToken}/moderate`, {
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    data: { action: 'restore' }
  });
  expect(restoreResponse.ok()).toBe(true);

  // Verify accessible again
  await page.goto(shareUrl);
  await expect(page.getByText('to-restore.txt', { exact: false })).toBeVisible({ timeout: 10_000 });
});

/**
 * Smoke test: the admin dashboard loads and requires authentication.
 * Unauthenticated access to the admin dashboard should redirect to the login page.
 */
test('admin dashboard requires authentication', async ({ page }) => {
  const response = await page.goto(`${BASE_URL}/admin`);

  // Should either redirect to login or show an auth wall
  const currentUrl = page.url();
  const loginRequired =
    currentUrl.includes('/admin/login') ||
    currentUrl.includes('/auth/login') ||
    (await page.locator(':text("Sign in"), :text("Log in"), :text("GitHub")').count()) > 0;

  expect(loginRequired || response?.status() === 401).toBe(true);
});
