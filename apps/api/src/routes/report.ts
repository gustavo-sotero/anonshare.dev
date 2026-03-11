import { Hono } from 'hono';

// Placeholder — implemented in Module 6
export const reportRouter = new Hono();

reportRouter.post('/:token', (c) => c.json({ error: 'not_implemented' }, 501));
