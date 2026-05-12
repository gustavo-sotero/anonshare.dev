import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  API_URL,
  BASE_URL,
  submitShareReport,
  uploadFile
} from './helpers';

function buildSeedIp(index: number): string {
  const thirdOctet = Math.floor(index / 200) + 10;
  const fourthOctet = (index % 200) + 1;
  return `198.51.${thirdOctet}.${fourthOctet}`;
}

async function seedPreviewEnabledFiles(count: number): Promise<string[]> {
  const filenames: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const filename = `cursor-preview-${String(index).padStart(2, '0')}.txt`;
    filenames.push(filename);

    await uploadFile({
      filename,
      content: `preview-enabled seed ${index}`,
      allowPreview: true,
      forwardedFor: buildSeedIp(index)
    });
  }

  return filenames;
}

async function seedMalwareReports(count: number): Promise<string[]> {
  const messages: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const filename = `cursor-report-${String(index).padStart(2, '0')}.txt`;
    const upload = await uploadFile({
      filename,
      content: `report seed ${index}`,
      forwardedFor: buildSeedIp(index + 300)
    });

    const message = `report-pagination-${String(index).padStart(2, '0')}`;
    messages.push(message);

    await submitShareReport({
      shareToken: upload.shareToken,
      reason: 'malware',
      message,
      forwardedFor: buildSeedIp(index + 600)
    });
  }

  return messages;
}

test.describe('authenticated admin flows', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

  /**
   * Admin hide/restore affects public visibility.
   *
   * The authenticated browser context inherits a stored admin session from the
   * Playwright setup project, so moderation requests use the same cookie jar as
   * the dashboard UI instead of injecting cookies ad hoc per test.
   */
  test('admin hide makes file unavailable on share page', async ({ page }) => {
    const { shareToken, shareUrl } = await uploadFile({
      filename: 'to-hide.txt',
      content: 'This file will be hidden'
    });

    await page.goto(shareUrl);
    await expect(page.getByText('to-hide.txt', { exact: false })).toBeVisible();

    const hideResponse = await page.request.post(`${API_URL}/admin/files/${shareToken}/moderate`, {
      data: { action: 'hide' }
    });
    expect(hideResponse.ok()).toBe(true);

    await page.goto(shareUrl);
    await expect(page.getByText('This file is not available.')).toBeVisible({ timeout: 10_000 });
  });

  /**
   * Admin restore makes a previously hidden file accessible again.
   */
  test('admin restore makes hidden file accessible again', async ({ page }) => {
    const { shareToken, shareUrl } = await uploadFile({
      filename: 'to-restore.txt',
      content: 'This file will be hidden then restored'
    });

    await page.request.post(`${API_URL}/admin/files/${shareToken}/moderate`, {
      data: { action: 'hide' }
    });

    await page.goto(shareUrl);
    await expect(page.getByText('This file is not available.')).toBeVisible({ timeout: 10_000 });

    const restoreResponse = await page.request.post(
      `${API_URL}/admin/files/${shareToken}/moderate`,
      {
        data: { action: 'restore' }
      }
    );
    expect(restoreResponse.ok()).toBe(true);

    await page.goto(shareUrl);
    await expect(page.getByText('to-restore.txt', { exact: false })).toBeVisible({
      timeout: 10_000
    });
  });

  test('admin files cursor pagination updates the URL and reveals older uploads', async ({
    page
  }) => {
    const filenames = await seedPreviewEnabledFiles(21);
    const earliestFilename = filenames[0];
    const latestFilename = filenames.at(-1);

    if (!earliestFilename || !latestFilename) {
      throw new Error('Expected seeded preview-enabled files for pagination test.');
    }

    await page.goto('/admin?tab=files&filesPolicy=preview_enabled');

    await expect(page.getByRole('heading', { name: latestFilename })).toBeVisible({
      timeout: 15_000
    });
    await expect(page.getByRole('heading', { name: earliestFilename })).toHaveCount(0);

    await page.getByRole('button', { name: 'Next →' }).click();

    await expect(page).toHaveURL(/filesCursor=/);
    await expect(page.getByRole('button', { name: '← First page' })).toBeVisible();
    await expect(page.getByRole('heading', { name: earliestFilename })).toBeVisible({
      timeout: 15_000
    });
  });

  test('admin reports cursor pagination updates the URL and reveals older reports', async ({
    page
  }) => {
    const messages = await seedMalwareReports(21);
    const earliestMessage = messages[0];
    const latestMessage = messages.at(-1);

    if (!earliestMessage || !latestMessage) {
      throw new Error('Expected seeded report messages for pagination test.');
    }

    await page.goto('/admin?tab=reports&reportsReason=malware');

    await expect(page.getByText(latestMessage)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(earliestMessage)).toHaveCount(0);

    await page.getByRole('button', { name: 'Next →' }).click();

    await expect(page).toHaveURL(/reportsCursor=/);
    await expect(page.getByRole('button', { name: '← First page' })).toBeVisible();
    await expect(page.getByText(earliestMessage)).toBeVisible({ timeout: 15_000 });
  });
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
