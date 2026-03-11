import { Hono } from 'hono';

// Placeholder — implemented in Module 4
export const shareRouter = new Hono();

shareRouter.get('/:token', (c) => c.json({ error: 'not_implemented' }, 501));
shareRouter.get('/:token/download', (c) => c.json({ error: 'not_implemented' }, 501));
