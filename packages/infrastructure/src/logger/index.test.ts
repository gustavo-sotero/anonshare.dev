import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// We cannot easily import the logger directly without side-effects, so let's
// test the module by dynamically importing it.

describe('logger', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let capturedOutput: { level: string; args: unknown[] }[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  beforeEach(() => {
    capturedOutput = [];
    console.log = mock((...args: unknown[]) => {
      capturedOutput.push({ level: 'log', args });
    }) as typeof console.log;
    console.warn = mock((...args: unknown[]) => {
      capturedOutput.push({ level: 'warn', args });
    }) as typeof console.warn;
    console.error = mock((...args: unknown[]) => {
      capturedOutput.push({ level: 'error', args });
    }) as typeof console.error;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  test('logger.info emits JSON with required fields in production mode', async () => {
    const { logger } = await import('./index');
    logger.info('test message', { event: 'test_event', actor: 'anonymous' });
    expect(capturedOutput).toHaveLength(1);
    expect(capturedOutput[0]?.level).toBe('log');
    const entry = JSON.parse(capturedOutput[0]?.args[0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('test message');
    expect(entry.event).toBe('test_event');
    expect(entry.actor).toBe('anonymous');
    expect(entry.timestamp).toBeDefined();
  });

  test('logger.error routes through console.error', async () => {
    const { logger } = await import('./index');
    logger.error('fail', { event: 'err' });
    expect(capturedOutput).toHaveLength(1);
    expect(capturedOutput[0]?.level).toBe('error');
  });

  test('logger.warn routes through console.warn', async () => {
    const { logger } = await import('./index');
    logger.warn('caution', { event: 'w' });
    expect(capturedOutput).toHaveLength(1);
    expect(capturedOutput[0]?.level).toBe('warn');
  });

  test('withContext merges default fields into every log entry', async () => {
    const { logger } = await import('./index');
    const child = logger.withContext({ service: 'api', requestId: 'req-123' });
    child.info('child message', { event: 'child_event' });
    expect(capturedOutput).toHaveLength(1);
    const entry = JSON.parse(capturedOutput[0]?.args[0] as string);
    expect(entry.service).toBe('api');
    expect(entry.requestId).toBe('req-123');
    expect(entry.event).toBe('child_event');
  });

  test('withContext allows call-site overrides of default fields', async () => {
    const { logger } = await import('./index');
    const child = logger.withContext({ actor: 'worker' });
    child.info('override', { actor: 'admin', event: 'override_test' });
    const entry = JSON.parse(capturedOutput[0]?.args[0] as string);
    expect(entry.actor).toBe('admin');
  });

  test('withContext chains correctly', async () => {
    const { logger } = await import('./index');
    const child1 = logger.withContext({ service: 'worker' });
    const child2 = child1.withContext({ requestId: 'job-456' });
    child2.info('chained', { event: 'chain_test' });
    const entry = JSON.parse(capturedOutput[0]?.args[0] as string);
    expect(entry.service).toBe('worker');
    expect(entry.requestId).toBe('job-456');
    expect(entry.event).toBe('chain_test');
  });
});
