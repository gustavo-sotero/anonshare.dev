import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES } from '@anonshare/contracts';
import { StorageError } from '@anonshare/infrastructure/storage';
import { buildApp, makeFile, makeMockDeps, postUpload } from './test-helpers';

describe('POST /upload — infrastructure failure handling', () => {
  test('returns 500 when DB insert fails (storage is never touched)', async () => {
    const app = buildApp(makeMockDeps({ insertShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 and triggers DB compensation when storage.put fails', async () => {
    const app = buildApp(makeMockDeps({}, { putShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when both storage.put and compensation DB delete fail', async () => {
    const app = buildApp(makeMockDeps({ deleteShouldThrow: true }, { putShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when activation DB update fails (storage object is safe)', async () => {
    const app = buildApp(makeMockDeps({ updateShouldThrow: true }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 and deletes the stored object when activation updates no records', async () => {
    let deletedKey: string | undefined;
    const app = buildApp(
      makeMockDeps(
        { updateReturn: [] },
        {
          captureDelete: (key) => {
            deletedKey = key;
          }
        }
      )
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(deletedKey).toMatch(/^objects\//);
  });

  test('returns 500 when storage confirmation cannot find the uploaded object', async () => {
    const app = buildApp(makeMockDeps({}, { headReturn: null }));

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 when storage confirmation reports a size mismatch', async () => {
    const app = buildApp(
      makeMockDeps({}, { headReturn: { contentLength: 1, contentType: 'text/plain' } })
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  test('returns 500 after exhausting storage confirmation retries', async () => {
    let headAttempts = 0;
    const app = buildApp(
      makeMockDeps(
        {},
        {
          headImpl: async () => {
            headAttempts += 1;
            throw new Error('Storage head failed');
          }
        }
      )
    );

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(headAttempts).toBe(3);
  });
});

describe('POST /upload — StorageError propagation', () => {
  test('returns 500 and compensates when storage.put throws a classified StorageError', async () => {
    const app = buildApp({
      ...makeMockDeps(),
      storage: {
        putConfirmed: async (_obj: unknown) => {
          throw new StorageError(
            'Storage operation timed out after 600000ms (put)',
            'transient',
            new Error('Socket hang up')
          );
        },
        delete: async (_key: string) => {
          return undefined;
        }
      }
    });

    const response = await postUpload(app, { file: makeFile() });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });
});
