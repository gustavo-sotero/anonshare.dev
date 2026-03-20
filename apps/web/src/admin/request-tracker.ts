import { useEffect, useRef } from 'react';

export type RequestTracker = {
  activate: () => void;
  beginRequest: () => { isCurrent: () => boolean; signal: AbortSignal };
  dispose: () => void;
};

export function createRequestTracker(): RequestTracker {
  let active = true;
  let lifecycleId = 0;
  let latestRequestId = 0;
  let currentController: AbortController | null = null;

  return {
    activate() {
      lifecycleId += 1;
      active = true;
    },
    beginRequest() {
      // Abort any in-flight request before starting a new one
      currentController?.abort();

      latestRequestId += 1;
      const requestId = latestRequestId;
      const requestLifecycleId = lifecycleId;
      const controller = new AbortController();
      currentController = controller;

      return {
        isCurrent: () =>
          active && lifecycleId === requestLifecycleId && latestRequestId === requestId,
        signal: controller.signal
      };
    },
    dispose() {
      lifecycleId += 1;
      active = false;
      currentController?.abort();
      currentController = null;
    }
  };
}

export async function runTrackedRequest<T>(params: {
  tracker: RequestTracker;
  run: (signal: AbortSignal) => Promise<T>;
  onSuccess: (value: T) => void;
  onError?: (error: unknown) => void;
  onFinally?: () => void;
}): Promise<void> {
  const { isCurrent, signal } = params.tracker.beginRequest();

  try {
    const value = await params.run(signal);

    if (!isCurrent()) {
      return;
    }

    params.onSuccess(value);
  } catch (error) {
    if (!isCurrent()) {
      return;
    }

    // Swallow abort errors — they are expected when a newer request supersedes
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    params.onError?.(error);
  } finally {
    if (isCurrent()) {
      params.onFinally?.();
    }
  }
}

export function useRequestTracker(): RequestTracker {
  const trackerRef = useRef<RequestTracker | null>(null);

  if (!trackerRef.current) {
    trackerRef.current = createRequestTracker();
  }

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker?.activate();

    return () => tracker?.dispose();
  }, []);

  return trackerRef.current;
}
