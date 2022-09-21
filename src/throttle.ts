export interface ResetPromise<T> {
  (): Promise<T>;
  reset: () => void;
}

export function throttle<T>(fn: () => Promise<T>, wait_ms: number): ResetPromise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  let cachedResult: Promise<T> | undefined;
  function reset() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = cachedResult = undefined;
  }
  const doThrottle: ResetPromise<T> = () => {
    if (!cachedResult) {
      cachedResult = fn().finally(() => {
        timeoutId = setTimeout(reset, wait_ms);
      });
    }
    return cachedResult;
  };
  doThrottle.reset = reset;
  return doThrottle;
}
