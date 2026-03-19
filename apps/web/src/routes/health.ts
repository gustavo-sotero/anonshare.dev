import { createFileRoute } from '@tanstack/react-router';

export function buildWebHealthResponse(now = new Date()): Response {
  return Response.json(
    {
      service: 'web',
      status: 'ok',
      timestamp: now.toISOString()
    },
    {
      status: 200,
      headers: { 'cache-control': 'no-store' }
    }
  );
}

export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: () => buildWebHealthResponse()
    }
  }
});
