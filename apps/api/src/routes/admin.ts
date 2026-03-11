import { Hono } from 'hono';

// Placeholder — implemented in Module 7
export const adminRouter = new Hono();

adminRouter.get('/files', (c) => c.json({ error: 'not_implemented' }, 501));
adminRouter.get('/reports', (c) => c.json({ error: 'not_implemented' }, 501));
adminRouter.get('/stats', (c) => c.json({ error: 'not_implemented' }, 501));
