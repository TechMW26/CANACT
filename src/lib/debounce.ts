/**
 * Debounce utilities for batching and deferring high-frequency operations.
 */

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delayMs) {
      lastCall = now;
      fn(...args);
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        timeoutId = null;
      }, delayMs - (now - lastCall));
    }
  };
}

/**
 * Batch updates to a callback, coalescing rapid calls.
 * Useful for reducing re-renders when data updates are frequent.
 */
export function batchUpdates<T>(
  cb: (data: T) => void,
  delayMs: number = 50,
): (data: T) => void {
  let pending: T | undefined;
  let scheduled = false;
  return (data: T) => {
    pending = data;
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      if (pending !== undefined) {
        cb(pending);
      }
      scheduled = false;
    }, delayMs);
  };
}
