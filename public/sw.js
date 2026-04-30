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

// Hostnames that must always hit the network.
const DATA_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'googleapis.com',
  'gstatic.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'public.blob.vercel-storage.com',
];

// Same-origin paths that must always hit the network.
const DATA_PATH_PREFIXES = ['/api/', '/__/'];

self.addEventListener('install', (event) => {
  // Activate immediately so the new shell takes effect on next navigation.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

function isDataRequest(url) {
  if (DATA_HOSTS.some((h) => url.hostname.endsWith(h))) return true;
  if (url.origin === self.location.origin) {
    return DATA_PATH_PREFIXES.some((p) => url.pathname.startsWith(p));
  }
  return false;
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
// (used when we want to apply a pending update immediately).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
