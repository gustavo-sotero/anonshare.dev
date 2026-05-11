import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES, uploadRequestSchema } from '@anonshare/contracts';
import { MAX_EXPIRATION_DAYS, MAX_FILE_SIZE_BYTES } from '@anonshare/domain';
import {
  buildApp,
  makeFile,
  makeFutureDate,
  makeMockDeps,
  postUpload,
  yesterdayIso
} from './test-helpers';

describe('POST /upload — pre-flight size guard (content-length header)', () => {
  const app = buildApp();

  test('rejects when the declared content-length exceeds the 256 MB limit', async () => {
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-length': String(MAX_FILE_SIZE_BYTES + 65_536 + 1)
      },
      body: new Uint8Array(10)
    });

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.FILE_TOO_LARGE);
  });
});

describe('POST /upload — metadata validation', () => {
  const app = buildApp();

  test('rejects malformed multipart payloads with a validation error', async () => {
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=broken-boundary'
      },
      body: '--broken-boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\n'
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects when the file field is absent', async () => {
    const form = new FormData();
    form.append('oneTime', 'false');
    const response = await app.request('http://localhost/upload', {
      method: 'POST',
      body: form
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects one-time + allow-preview combination (PRD invariant)', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      oneTime: true,
      allowPreview: true
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects expiration beyond MAX_EXPIRATION_DAYS', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      expiresAt: makeFutureDate(MAX_EXPIRATION_DAYS + 1)
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('rejects a past expiration date', async () => {
    const response = await postUpload(app, {
      file: makeFile(),
      expiresAt: yesterdayIso()
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  test('substitutes "upload" as fallback when filename is empty and accepts the upload', async () => {
    const mockApp = buildApp(makeMockDeps());
    const emptyNameFile = new File([new Uint8Array(1024)], '', { type: 'text/plain' });
    const response = await postUpload(mockApp, { file: emptyNameFile });

    expect(response.status).toBe(201);
  });
});

describe('uploadRequestSchema — MIME type validation', () => {
  test('rejects a mimeType with no slash (not type/subtype format)', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.bin',
      mimeType: 'notamimetype',
      sizeBytes: 1024,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(false);
  });

  test('rejects a mimeType with more than two slash-delimited segments', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.bin',
      mimeType: 'application/json/extra',
      sizeBytes: 1024,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(false);
  });

  test('accepts a MIME type with a charset parameter', () => {
    const result = uploadRequestSchema.safeParse({
      filename: 'file.txt',
      mimeType: 'text/plain;charset=utf-8',
      sizeBytes: 512,
      oneTime: false,
      allowPreview: false,
      expiresAt: null
    });
    expect(result.success).toBe(true);
  });
});
