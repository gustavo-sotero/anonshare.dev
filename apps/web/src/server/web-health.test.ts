import { describe, expect, test } from 'bun:test';
import { buildWebHealthResponse } from '../routes/health';

describe('web health route', () => {
  test('returns an uncached ok payload for the SSR process', async () => {
    const response = buildWebHealthResponse(new Date('2026-03-19T13:45:00.000Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      status: 'ok',
      timestamp: '2026-03-19T13:45:00.000Z'
    });
  });
});