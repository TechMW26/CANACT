/* Canact service worker.
 *
 * Strategy: instant-paint UI, always-fresh data.
 *
 *  - The "shell" (HTML documents, JS/CSS chunks, fonts, icons, images,
 *    SVGs, audio served from our own origin) is served cache-first so
 *    repeat visits paint immediately without a network round-trip.
 *  - Anything that is data (Firebase RTDB, Firebase Auth handler, our
 *    own /api/*, Vercel Blob storage, Google APIs) is forced through
 *    the network so users always see the latest content.
 *  - Each deploy sets a new ?v=BUILD_ID on the registration URL, so a
 *    new sw.js installs, takes over via clients.claim(), and wipes
 *    every previous shell cache. The page detects the controller
 *    change and reloads ONCE so the new UI is picked up without the
 *    user having to refresh manually.
 *  - On a complete network failure we fall back to the last cached
 *    HTML document so the app shell still opens (offline-resilient).
 */

// The version is rewritten at install time \u2014 we read it from the
// registration URL search param ?v=...\u00a0 so that we don't have to
// pre-process this file at build time.
let BUILD_ID = 'dev';
try {
  const u = new URL(self.location.href);
  BUILD_ID = u.searchParams.get('v') || 'dev';
} catch {}

const SHELL_CACHE = `canact-shell-${BUILD_ID}`;
const RUNTIME_CACHE = `canact-runtime-${BUILD_ID}`;
// Media cache lives across deploys (BUILD_ID is intentionally NOT in the
// name) so users keep their downloaded posts when a new app version ships.
// Entries are individually TTL'd via the `x-canact-cached-at` header we
// stamp at write time and culled to MEDIA_CACHE_MAX entries (LRU-ish:
// oldest entry by stored timestamp wins eviction).
const MEDIA_CACHE = 'canact-media-v1';
const MAP_TILE_CACHE = 'canact-map-tiles-v1';
const MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MEDIA_CACHE_MAX = 250;
const MAP_TILE_CACHE_MAX = 900;
const MAP_PREFETCH_MAX_URLS = 180;
const MAP_PREFETCH_CONCURRENCY = 4;
const MEDIA_HOSTS = ['public.blob.vercel-storage.com', 'googleusercontent.com'];
// Every host used by the app's map renderers. OpenFreeMap serves the
// MapLibre style, vector/raster tiles, sprites and glyphs from the same host,
// so caching it makes a previously viewed area immediately reusable.
const MAP_TILE_HOSTS = [
  'tiles.openfreemap.org',
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
];
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.png',
  '/ringer.mp3',
  '/ringtone.mp3',
  '/video-poster.svg',
];

// Hostnames that must always hit the network.
const DATA_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'googleapis.com',
  'gstatic.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

// Same-origin paths that must always hit the network.
const DATA_PATH_PREFIXES = ['/api/', '/__/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(PRECACHE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      } catch {
        // A failed decorative asset should never block SW activation.
      }
      // Activate immediately so the new shell takes effect on next navigation.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE && n !== MEDIA_CACHE && n !== MAP_TILE_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
      // Opportunistic GC: evict media entries that exceeded TTL.
      try { await pruneMediaCache(); } catch {}
      try { await pruneMapTileCache(); } catch {}
    })()
  );
});

function isMediaRequest(url) {
  return MEDIA_HOSTS.some((h) => url.hostname.endsWith(h));
}

function isMapTileRequest(url) {
  return MAP_TILE_HOSTS.some((h) => url.hostname.endsWith(h));
}

function isDataRequest(url) {
  if (DATA_HOSTS.some((h) => url.hostname.endsWith(h))) return true;
  if (url.origin === self.location.origin) {
    return DATA_PATH_PREFIXES.some((p) => url.pathname.startsWith(p));
  }
  return false;
}

/** Cache-first with TTL for media (post images / videos / avatars). On HIT
 *  we serve from cache instantly without any network round-trip — that's
 *  the whole point of "download to device storage". On MISS or expired
 *  entry we fetch, stamp `x-canact-cached-at`, and store. After a write we
 *  schedule a prune so the cache doesn't grow without bound. */
async function cacheFirstMedia(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) {
    const ts = Number(cached.headers.get('x-canact-cached-at') || 0);
    if (ts && Date.now() - ts < MEDIA_TTL_MS) {
      return cached;
    }
    // Stale: drop and re-fetch.
    cache.delete(req, { ignoreVary: true }).catch(() => {});
  }
  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    // Offline: serve the stale copy if we still have one (better than a
    // broken-image icon while the user is on the subway).
    if (cached) return cached;
    throw err;
  }
  // Only cache 200/206 — skip range partials with non-OK status, redirects, errors.
  if (res && res.ok && (res.status === 200 || res.status === 206)) {
    try {
      const cloned = res.clone();
      const buf = await cloned.arrayBuffer();
      const headers = new Headers(res.headers);
      headers.set('x-canact-cached-at', String(Date.now()));
      const stamped = new Response(buf, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
      cache.put(req, stamped).catch(() => {});
      // Fire-and-forget eviction sweep so we stay under MEDIA_CACHE_MAX.
      pruneMediaCache().catch(() => {});
    } catch { /* cache failure is non-fatal */ }
  }
  return res;
}

async function cacheFirstMapTile(req) {
  const cache = await caches.open(MAP_TILE_CACHE);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).catch(() => {});
    pruneMapTileCache().catch(() => {});
  }
  return res;
}

async function prefetchMapTiles(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const cleanUrls = [];
  const seen = new Set();
  for (const rawUrl of urls) {
    if (cleanUrls.length >= MAP_PREFETCH_MAX_URLS) break;
    try {
      const url = new URL(rawUrl);
      if (!isMapTileRequest(url)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      cleanUrls.push(url.href);
    } catch {}
  }
  if (!cleanUrls.length) return;

  const cache = await caches.open(MAP_TILE_CACHE);
  let index = 0;
  const worker = async () => {
    while (index < cleanUrls.length) {
      const url = cleanUrls[index];
      index += 1;
      if (!url) continue;
      try {
        const req = new Request(url, { mode: 'no-cors', credentials: 'omit', cache: 'force-cache' });
        const cached = await cache.match(req, { ignoreVary: true });
        if (cached) continue;
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res.clone());
      } catch {
        // Best-effort warm-up only.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAP_PREFETCH_CONCURRENCY, cleanUrls.length) }, worker));
  await pruneMapTileCache();
}

async function pruneMapTileCache() {
  const cache = await caches.open(MAP_TILE_CACHE);
  const reqs = await cache.keys();
  if (reqs.length <= MAP_TILE_CACHE_MAX) return;
  await Promise.all(
    reqs
      .slice(0, reqs.length - MAP_TILE_CACHE_MAX)
      .map((req) => cache.delete(req, { ignoreVary: true }).catch(() => {}))
  );
}

/** Evict expired entries first, then trim oldest until we're under cap. */
async function pruneMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const reqs = await cache.keys();
  const entries = [];
  for (const r of reqs) {
    const m = await cache.match(r, { ignoreVary: true });
    const ts = Number((m && m.headers.get('x-canact-cached-at')) || 0);
    entries.push({ req: r, ts });
  }
  const now = Date.now();
  // Hard-evict expired entries.
  await Promise.all(
    entries
      .filter((e) => e.ts && now - e.ts > MEDIA_TTL_MS)
      .map((e) => cache.delete(e.req, { ignoreVary: true }).catch(() => {}))
  );
  // Re-fetch survivors and trim if still over cap (oldest first).
  const surviving = entries.filter((e) => !(e.ts && now - e.ts > MEDIA_TTL_MS));
  if (surviving.length <= MEDIA_CACHE_MAX) return;
  surviving.sort((a, b) => a.ts - b.ts);
  const overflow = surviving.length - MEDIA_CACHE_MAX;
  await Promise.all(
    surviving
      .slice(0, overflow)
      .map((e) => cache.delete(e.req, { ignoreVary: true }).catch(() => {}))
  );
}

/** Drop a specific URL (or list of URLs) from the media cache. Called from
 *  the page when a post is deleted by its owner — the URL is no longer
 *  reachable on the CDN so there's no point keeping it around taking up
 *  user storage. */
async function invalidateMedia(urls) {
  if (!urls || !urls.length) return;
  const cache = await caches.open(MEDIA_CACHE);
  await Promise.all(
    urls.map((u) => {
      try { return cache.delete(new Request(u), { ignoreVary: true }); }
      catch { return Promise.resolve(false); }
    })
  );
}

function isShellRequest(req, url) {
  if (url.origin !== self.location.origin) return false;
  if (req.method !== 'GET') return false;
  if (req.mode === 'navigate') return true;
  const dest = req.destination;
  return (
    dest === 'script' ||
    dest === 'style' ||
    dest === 'font' ||
    dest === 'image' ||
    dest === 'audio'
  );
}

// Cache-first with background refresh: serve from cache if present,
// kick off a network revalidation in parallel so the cache is fresh
// the next time. This is the "stale-while-revalidate" pattern.
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || cache.match(req);
}

// For navigations: try network first (so we always pick up new HTML
// when online) but fall back to the last cached document so the app
// still opens cold/offline.
async function networkFirstNavigation(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-ditch fallback: any cached document.
    const all = await cache.keys();
    for (const k of all) {
      if (k.destination === 'document' || k.mode === 'navigate') {
        const r = await cache.match(k);
        if (r) return r;
      }
    }
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only intercept GET; POST/PUT/etc. go straight to the network.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Media (Vercel Blob CDN): cache-first with TTL so the user only ever
  // downloads each post's image/video once. This is the perf win — feeds
  // re-render instantly from disk on revisit instead of re-hitting the CDN.
  if (isMediaRequest(url)) {
    event.respondWith(cacheFirstMedia(req));
    return;
  }

  if (isMapTileRequest(url)) {
    event.respondWith(cacheFirstMapTile(req));
    return;
  }

  // Always-fresh data \u2014 do not touch the cache.
  if (isDataRequest(url)) return;

  // App-shell strategy.
  if (isShellRequest(req, url)) {
    if (req.mode === 'navigate') {
      event.respondWith(networkFirstNavigation(req));
    } else {
      event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    }
  }
});

// Allow the page to ask the SW to skip the waiting step manually
// (used when we want to apply a pending update immediately) or to
// invalidate cached media URLs (used when a post is deleted).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'INVALIDATE_MEDIA' && Array.isArray(data.urls)) {
    event.waitUntil(invalidateMedia(data.urls));
    return;
  }
  if (data.type === 'PRUNE_MEDIA') {
    event.waitUntil(pruneMediaCache());
    return;
  }
  if (data.type === 'PREFETCH_MAP_TILES' && Array.isArray(data.urls)) {
    event.waitUntil(prefetchMapTiles(data.urls));
  }
});
