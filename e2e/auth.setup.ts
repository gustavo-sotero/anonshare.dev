import fs from 'node:fs';
import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH, API_URL } from './helpers';

const authFile = path.resolve(ADMIN_STORAGE_STATE_PATH);

setup('bootstrap admin auth state', async ({ request }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const response = await request.post(`${API_URL}/_internal/test/session`);
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as { ok?: boolean };
  expect(body.ok).toBe(true);

  const state = await request.storageState();
  expect(state.cookies.some((cookie) => cookie.value.length > 0)).toBe(true);

  await request.storageState({ path: authFile });
});
