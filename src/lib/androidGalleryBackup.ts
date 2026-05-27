'use client';

// Automated, Google-Photos-style gallery backup for Android (Capacitor native).
// Backed by the in-app CanactGalleryPlugin (android/app/src/main/java/com/canact/app/CanactGalleryPlugin.java).
// Web and iOS surfaces are unsupported: web has no API for full-library access
// and iOS has no Capacitor platform configured in this repo yet.
//
// Flow:
//   1. JS calls requestGalleryPermission() (after the user accepts the
//      in-app prominent disclosure modal). The OS surfaces the standard
//      runtime permission dialog for READ_MEDIA_IMAGES / READ_MEDIA_VIDEO.
//   2. On grant, runAndroidGalleryScan() enumerates every image + video
//      via MediaStore, diffs against the per-uid set of already-uploaded
//      MediaStore IDs we persist in localStorage, and uploads each new
//      item one at a time via uploadBackupFile() (existing pipeline).
//   3. The worker is re-armed on every foreground via the @capacitor/app
//      appStateChange listener wired up in DeviceBackupPrompt, so new
//      captures get picked up as soon as the user returns to the app.
//   4. Cancellation is cooperative: setDeviceBackupEnabled(uid, false)
//      flips a flag that the in-flight scan checks between items.

import {
  backupFileContentType,
  backupFileProblem,
  uploadBackupFile,
} from '@/lib/deviceBackup';

type NativeGalleryItem = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  dateAdded: number;
  kind: 'image' | 'video';
};

type GalleryPlugin = {
  checkGalleryPermission: () => Promise<{ granted: boolean }>;
  requestGalleryPermission: () => Promise<{ granted: boolean }>;
  listMedia: (opts?: { since?: number }) => Promise<{ items: NativeGalleryItem[] }>;
  cacheMedia: (opts: { uri: string }) => Promise<{ path: string }>;
  releaseCacheFile: (opts: { path: string }) => Promise<void>;
};

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  platform?: string;
  convertFileSrc?: (path: string) => string;
  Plugins?: Record<string, any>;
};

type GalleryScanProgress = {
  scanned: number;
  uploaded: number;
  skipped: number;
  errors: number;
  currentName?: string;
  currentPercent?: number;
};

type GalleryScanCallbacks = {
  isEnabled: () => boolean;
  onProgress?: (progress: GalleryScanProgress) => void;
  onComplete?: (progress: GalleryScanProgress) => void;
};

const KNOWN_IDS_KEY_PREFIX = 'canact:backup:android:knownIds:';
const LAST_SCAN_KEY_PREFIX = 'canact:backup:android:lastScanAt:';
const SCAN_LOCK = new Set<string>();

function getBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as any).Capacitor ?? null;
}

export function isAndroidNative(): boolean {
  const cap = getBridge();
  if (!cap) return false;
  const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : cap.platform;
  return isNative && platform === 'android';
}

function getGalleryPlugin(): GalleryPlugin | null {
  const cap = getBridge();
  const plugin = cap?.Plugins?.CanactGallery as GalleryPlugin | undefined;
  if (!plugin?.requestGalleryPermission || !plugin?.listMedia || !plugin?.cacheMedia) return null;
  return plugin;
}

export async function checkAndroidGalleryPermission(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const plugin = getGalleryPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.checkGalleryPermission();
    return !!result?.granted;
  } catch {
    return false;
  }
}

export async function requestAndroidGalleryPermission(): Promise<boolean> {
  if (!isAndroidNative()) return false;
  const plugin = getGalleryPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.requestGalleryPermission();
    return !!result?.granted;
  } catch {
    return false;
  }
}

function knownIdsKey(uid: string): string {
  return `${KNOWN_IDS_KEY_PREFIX}${uid}`;
}

function lastScanKey(uid: string): string {
  return `${LAST_SCAN_KEY_PREFIX}${uid}`;
}

function loadKnownIds(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(knownIdsKey(uid));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveKnownIds(uid: string, ids: Set<string>): void {
  try {
    // Cap the persisted list at ~50k entries to keep localStorage small.
    const arr = Array.from(ids);
    const trimmed = arr.length > 50000 ? arr.slice(arr.length - 50000) : arr;
    localStorage.setItem(knownIdsKey(uid), JSON.stringify(trimmed));
  } catch {}
}

function loadLastScanAt(uid: string): number {
  try {
    const raw = localStorage.getItem(lastScanKey(uid));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveLastScanAt(uid: string, ts: number): void {
  try {
    localStorage.setItem(lastScanKey(uid), String(ts));
  } catch {}
}

function convertCachedPathToFetchUrl(path: string): string {
  const cap = getBridge();
  if (cap && typeof cap.convertFileSrc === 'function') {
    return cap.convertFileSrc(path);
  }
  // Fallback for older Capacitor where convertFileSrc isn't exposed.
  return path.startsWith('file://') ? path : `file://${path}`;
}

async function materializeNativeItem(plugin: GalleryPlugin, item: NativeGalleryItem): Promise<{ file: File; cachedPath: string } | null> {
  let cachedPath: string | null = null;
  try {
    const cache = await plugin.cacheMedia({ uri: item.uri });
    cachedPath = cache?.path ?? null;
    if (!cachedPath) return null;
    const fetchUrl = convertCachedPathToFetchUrl(cachedPath);
    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error(`fetch ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], item.name || `media-${item.id}`, {
      type: item.mimeType || blob.type || 'application/octet-stream',
    });
    return { file, cachedPath };
  } catch (error) {
    if (cachedPath) {
      try { await plugin.releaseCacheFile({ path: cachedPath }); } catch {}
    }
    return null;
  }
}

/**
 * Enumerate the device gallery and upload anything we haven't seen before.
 * Cooperative: stops between items when callbacks.isEnabled() returns false.
 */
export async function runAndroidGalleryScan(uid: string, callbacks: GalleryScanCallbacks): Promise<GalleryScanProgress> {
  const result: GalleryScanProgress = { scanned: 0, uploaded: 0, skipped: 0, errors: 0 };
  if (!isAndroidNative()) return result;
  const plugin = getGalleryPlugin();
  if (!plugin) return result;
  if (SCAN_LOCK.has(uid)) return result;
  SCAN_LOCK.add(uid);

  try {
    const granted = await checkAndroidGalleryPermission();
    if (!granted) return result;

    const since = loadLastScanAt(uid);
    let listed: NativeGalleryItem[];
    try {
      const response = await plugin.listMedia({ since });
      listed = Array.isArray(response?.items) ? response.items : [];
    } catch {
      return result;
    }

    const known = loadKnownIds(uid);
    let highestDate = since;

    for (const item of listed) {
      if (!callbacks.isEnabled()) break;
      result.scanned += 1;
      highestDate = Math.max(highestDate, item.dateAdded || 0);

      if (known.has(item.id)) {
        result.skipped += 1;
        continue;
      }

      const probeFile = new File([new Blob([])], item.name || 'media', { type: item.mimeType || '' });
      const problem = backupFileProblem(probeFile);
      const contentType = backupFileContentType(probeFile);
      if (problem || !contentType) {
        // Type not in the supported allow-list - skip permanently.
        known.add(item.id);
        result.skipped += 1;
        continue;
      }

      const materialized = await materializeNativeItem(plugin, item);
      if (!materialized) {
        result.errors += 1;
        continue;
      }

      try {
        callbacks.onProgress?.({ ...result, currentName: item.name, currentPercent: 0 });
        await uploadBackupFile(materialized.file, {
          uid,
          onProgress: ({ percentage }) => {
            callbacks.onProgress?.({
              ...result,
              currentName: item.name,
              currentPercent: Math.round(percentage || 0),
            });
          },
        });
        known.add(item.id);
        result.uploaded += 1;
        callbacks.onProgress?.({ ...result, currentName: undefined, currentPercent: 0 });
      } catch {
        result.errors += 1;
      } finally {
        try { await plugin.releaseCacheFile({ path: materialized.cachedPath }); } catch {}
      }

      // Persist progress periodically so a process kill doesn't lose state.
      if ((result.uploaded + result.skipped) % 20 === 0) {
        saveKnownIds(uid, known);
      }
    }

    saveKnownIds(uid, known);
    if (highestDate > 0) saveLastScanAt(uid, highestDate);
    callbacks.onComplete?.(result);
    return result;
  } finally {
    SCAN_LOCK.delete(uid);
  }
}

export function resetAndroidGalleryProgress(uid: string): void {
  try {
    localStorage.removeItem(knownIdsKey(uid));
    localStorage.removeItem(lastScanKey(uid));
  } catch {}
}
