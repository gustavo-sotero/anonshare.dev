import { Hono } from 'hono';

// Placeholder — implemented in Module 3
export const uploadRouter = new Hono();

uploadRouter.post('/', (c) => c.json({ error: 'not_implemented' }, 501));
