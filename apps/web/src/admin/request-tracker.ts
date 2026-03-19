import { useEffect, useRef } from 'react';

export type RequestTracker = {
  activate: () => void;
  beginRequest: () => () => boolean;
  dispose: () => void;
};

export function createRequestTracker(): RequestTracker {
  let active = true;
  let lifecycleId = 0;
  let latestRequestId = 0;

  return {
    activate() {
      lifecycleId += 1;
      active = true;
    },
    beginRequest() {
      latestRequestId += 1;
      const requestId = latestRequestId;
      const requestLifecycleId = lifecycleId;

      return () => active && lifecycleId === requestLifecycleId && latestRequestId === requestId;
    },
    dispose() {
      lifecycleId += 1;
      active = false;
    }
  };
}

export async function runTrackedRequest<T>(params: {
  tracker: RequestTracker;
  run: () => Promise<T>;
  onSuccess: (value: T) => void;
  onError?: (error: unknown) => void;
  onFinally?: () => void;
}): Promise<void> {
  const isCurrent = params.tracker.beginRequest();

  try {
    const value = await params.run();

    if (!isCurrent()) {
      return;
    }

    params.onSuccess(value);
  } catch (error) {
    if (!isCurrent()) {
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
