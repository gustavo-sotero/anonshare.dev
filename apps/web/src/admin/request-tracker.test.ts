import { describe, expect, it } from 'bun:test';
import { createRequestTracker, runTrackedRequest } from './request-tracker';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('createRequestTracker', () => {
  it('marks only the latest started request as current', () => {
    const tracker = createRequestTracker();
    const first = tracker.beginRequest();
    const second = tracker.beginRequest();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('invalidates requests after disposal', () => {
    const tracker = createRequestTracker();
    const isCurrent = tracker.beginRequest();

    tracker.dispose();

    expect(isCurrent()).toBe(false);
  });

  it('allows new requests after a disposal and reactivation cycle', () => {
    const tracker = createRequestTracker();
    const first = tracker.beginRequest();

    tracker.dispose();
    tracker.activate();

    const second = tracker.beginRequest();

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});

describe('runTrackedRequest', () => {
  it('ignores stale request completions when a newer request starts', async () => {
    const tracker = createRequestTracker();
    const first = createDeferred<number>();
    const second = createDeferred<number>();
    const results: string[] = [];

    const firstRun = runTrackedRequest({
      tracker,
      run: () => first.promise,
      onSuccess: (value) => results.push(`first:${value}`)
    });
    const secondRun = runTrackedRequest({
      tracker,
      run: () => second.promise,
      onSuccess: (value) => results.push(`second:${value}`)
    });

    first.resolve(1);
    await Promise.resolve();
    expect(results).toEqual([]);

    second.resolve(2);
    await Promise.all([firstRun, secondRun]);

    expect(results).toEqual(['second:2']);
  });

  it('skips callbacks after the tracker is disposed', async () => {
    const tracker = createRequestTracker();
    const deferred = createDeferred<number>();
    let called = false;

    const run = runTrackedRequest({
      tracker,
      run: () => deferred.promise,
      onSuccess: () => {
        called = true;
      }
    });

    tracker.dispose();
    deferred.resolve(1);
    await run;

    expect(called).toBe(false);
  });

  it('accepts new requests after reactivation while keeping prior ones stale', async () => {
    const tracker = createRequestTracker();
    const first = createDeferred<number>();
    const second = createDeferred<number>();
    const results: string[] = [];

    const firstRun = runTrackedRequest({
      tracker,
      run: () => first.promise,
      onSuccess: (value) => results.push(`first:${value}`)
    });

    tracker.dispose();
    tracker.activate();

    const secondRun = runTrackedRequest({
      tracker,
      run: () => second.promise,
      onSuccess: (value) => results.push(`second:${value}`)
    });

    second.resolve(2);
    await secondRun;

    first.resolve(1);
    await firstRun;

    expect(results).toEqual(['second:2']);
  });
});
