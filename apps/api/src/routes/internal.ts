import { Hono } from 'hono';

// Internal endpoints used by the worker (not public-facing)
export const internalRouter = new Hono();

internalRouter.post('/expire/:fileId', (c) => c.json({ error: 'not_implemented' }, 501));
internalRouter.post('/cleanup/:fileId', (c) => c.json({ error: 'not_implemented' }, 501));
