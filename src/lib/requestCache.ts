/**
 * Simple request deduplication and caching layer to reduce redundant Firebase calls.
 * Merges concurrent identical requests and caches results with TTL.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  resolve: (data: T) => void;
  reject: (err: any) => void;
}

export class RequestCache {
  private cache = new Map<string, CacheEntry<any>>();
  private pending = new Map<string, PendingRequest<any>>();

  /**
   * Execute a request with deduplication and optional caching.
   * If the same request is already in-flight, returns the same promise.
   * If cached data exists and is fresh, returns cached data.
   */
  async dedupe<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number = 5000,
  ): Promise<T> {
    const now = Date.now();

    // Return cached data if fresh
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }

    // Return pending promise if request is in-flight
    const pending = this.pending.get(key);
    if (pending) return pending.promise as Promise<T>;

    // Start new request
    let resolve: (data: T) => void;
    let reject: (err: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.pending.set(key, { promise, resolve: resolve!, reject: reject! });

    try {
      const data = await fn();
      this.cache.set(key, { data, expiresAt: now + ttlMs });
      resolve!(data);
      return data;
    } catch (err) {
      reject!(err);
      throw err;
    } finally {
      this.pending.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.pending.clear();
  }

  clearKey(key: string) {
    this.cache.delete(key);
    this.pending.delete(key);
  }
}

export const globalRequestCache = new RequestCache();
