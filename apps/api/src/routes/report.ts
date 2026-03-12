import { API_ERROR_CODES, shareTokenParamsSchema } from '@anonshare/contracts';
import { Hono } from 'hono';

function errorBody(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

function parseShareToken(token: string): string | null {
  const parsed = shareTokenParamsSchema.safeParse({ token });
  if (!parsed.success) {
    return null;
  }

  return parsed.data.token;
}

// Placeholder — full report persistence is implemented in Module 6.
// Keep this endpoint shape stable for frontend integration in Module 4.
export const reportRouter = new Hono();

reportRouter.post('/:token', (c) => {
  c.header('cache-control', 'no-store');

  const token = parseShareToken(c.req.param('token'));
  if (!token) {
    return c.json(errorBody(API_ERROR_CODES.NOT_FOUND, 'File not found'), 404);
  }

  return c.json(
    errorBody(API_ERROR_CODES.INTERNAL_ERROR, 'Report submission is not available yet.'),
    501
  );
});
