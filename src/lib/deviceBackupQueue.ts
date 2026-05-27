'use client';

import {
  backupFileContentType,
  backupFileProblem,
  uploadBackupFile,
  type BackupUploadProgress,
} from '@/lib/deviceBackup';
import {
  checkAndroidGalleryPermission,
  isAndroidNative,
  requestAndroidGalleryPermission,
  resetAndroidGalleryProgress,
  runAndroidGalleryScan,
} from '@/lib/androidGalleryBackup';

export type NativePhotoLibraryState = 'unavailable' | 'active' | 'error';

export type DeviceBackupSettings = {
  enabled: boolean;
  paused: boolean;
  updatedAt: number;
};

export type DeviceBackupSummary = DeviceBackupSettings & {
  pending: number;
  uploading: number;
  failed: number;
  uploaded: number;
  working: boolean;
  currentName?: string;
  currentPercent: number;
  lastError?: string;
  lastRunAt?: number;
  nativePhotoLibrary: NativePhotoLibraryState;
  nativeMessage?: string;
  storageAvailable: boolean;
};

export type BackupEnqueueResult = {
  queued: number;
  skipped: number;
  storageUnavailable: boolean;
};

type QueueStatus = 'pending' | 'uploading' | 'failed';

type BackupQueueItem = {
  id: string;
  uid: string;
  file: File;
  name: string;
  size: number;
  contentType: string;
  status: QueueStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

type BackupStats = {
  uploaded: number;
  working: boolean;
  currentName?: string;
  currentPercent: number;
  lastError?: string;
  lastRunAt?: number;
  nativePhotoLibrary: NativePhotoLibraryState;
  nativeMessage?: string;
};

type NativeBackupResult = {
  status: NativePhotoLibraryState;
  message?: string;
};

const DB_NAME = 'canact-device-backup';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const UPDATE_EVENT = 'canact:device-backup:update';
const MAX_ATTEMPTS = 3;

const runningWorkers = new Set<string>();
let queueDbPromise: Promise<IDBDatabase> | null = null;

export function defaultDeviceBackupSummary(): DeviceBackupSummary {
  return {
    enabled: false,
    paused: false,
    updatedAt: 0,
    pending: 0,
    uploading: 0,
    failed: 0,
    uploaded: 0,
    working: false,
    currentPercent: 0,
    nativePhotoLibrary: 'unavailable',
    storageAvailable: backupQueueStorageAvailable(),
  };
}

export function backupQueueStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function getDeviceBackupSettings(uid: string): DeviceBackupSettings {
  return readJson(settingsKey(uid), { enabled: false, paused: false, updatedAt: 0 });
}

export function setDeviceBackupEnabled(uid: string, enabled: boolean): void {
  const current = getDeviceBackupSettings(uid);
  writeJson(settingsKey(uid), {
    enabled,
    paused: enabled ? current.paused : false,
    updatedAt: Date.now(),
  });
  emitBackupUpdate(uid);
}

export function setDeviceBackupPaused(uid: string, paused: boolean): void {
  const current = getDeviceBackupSettings(uid);
  writeJson(settingsKey(uid), {
    ...current,
    enabled: true,
    paused,
    updatedAt: Date.now(),
  });
  emitBackupUpdate(uid);
}

export async function enableDeviceBackup(uid: string): Promise<NativeBackupResult> {
  setDeviceBackupEnabled(uid, true);
  setDeviceBackupPaused(uid, false);
  const native = await startNativePhotoLibraryBackup(uid);
  updateBackupStats(uid, {
    nativePhotoLibrary: native.status,
    nativeMessage: native.message,
  });
  emitBackupUpdate(uid);
  return native;
}

export async function enqueueBackupFiles(uid: string, selected: File[]): Promise<BackupEnqueueResult> {
  if (!backupQueueStorageAvailable()) {
    return { queued: 0, skipped: selected.length, storageUnavailable: true };
  }

  const now = Date.now();
  const items: BackupQueueItem[] = [];
  let skipped = 0;

  for (const file of selected) {
    const problem = backupFileProblem(file);
    const contentType = backupFileContentType(file);
    if (problem || !contentType) {
      skipped += 1;
      continue;
    }
    items.push({
      id: createQueueItemId(),
      uid,
      file,
      name: file.name || 'file',
      size: file.size,
      contentType,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (items.length) {
    await putQueueItems(items);
    emitBackupUpdate(uid);
  }

  return { queued: items.length, skipped, storageUnavailable: false };
}

export async function clearLocalBackupQueue(uid: string): Promise<void> {
  if (!backupQueueStorageAvailable()) return;
  const items = await getAllQueueItems();
  const ids = items.filter((item) => item.uid === uid).map((item) => item.id);
  if (!ids.length) return;
  await deleteQueueItems(ids);
  updateBackupStats(uid, {
    working: false,
    currentName: undefined,
    currentPercent: 0,
    lastError: undefined,
  });
  emitBackupUpdate(uid);
}

export async function getDeviceBackupSummary(uid: string): Promise<DeviceBackupSummary> {
  const settings = getDeviceBackupSettings(uid);
  const stats = getBackupStats(uid);
  const summary: DeviceBackupSummary = {
    ...settings,
    pending: 0,
    uploading: 0,
    failed: 0,
    uploaded: stats.uploaded,
    working: stats.working,
    currentName: stats.currentName,
    currentPercent: stats.currentPercent,
    lastError: stats.lastError,
    lastRunAt: stats.lastRunAt,
    nativePhotoLibrary: stats.nativePhotoLibrary,
    nativeMessage: stats.nativeMessage,
    storageAvailable: backupQueueStorageAvailable(),
  };

  if (!summary.storageAvailable) return summary;
  try {
    const items = await getAllQueueItems();
    for (const item of items) {
      if (item.uid !== uid) continue;
      if (item.status === 'pending') summary.pending += 1;
      else if (item.status === 'uploading') summary.uploading += 1;
      else if (item.status === 'failed') summary.failed += 1;
    }
  } catch (error: any) {
    summary.storageAvailable = false;
    summary.lastError = error?.message ?? 'Backup queue unavailable';
  }
  return summary;
}

export async function processDeviceBackupQueue(uid: string): Promise<void> {
  if (runningWorkers.has(uid) || !backupQueueStorageAvailable()) return;
  runningWorkers.add(uid);

  try {
    while (true) {
      const settings = getDeviceBackupSettings(uid);
      if (!settings.enabled || settings.paused) break;

      const item = await getNextQueueItem(uid);
      if (!item) break;

      const uploadingItem: BackupQueueItem = {
        ...item,
        status: 'uploading',
        updatedAt: Date.now(),
        lastError: undefined,
      };
      await putQueueItems([uploadingItem]);
      updateBackupStats(uid, {
        working: true,
        currentName: uploadingItem.name,
        currentPercent: 0,
        lastError: undefined,
      });
      emitBackupUpdate(uid);

      try {
        await uploadBackupFile(uploadingItem.file, {
          uid,
          onProgress: (progress: BackupUploadProgress) => {
            updateBackupStats(uid, {
              working: true,
              currentName: uploadingItem.name,
              currentPercent: Math.round(progress.percentage || 0),
            });
            emitBackupUpdate(uid);
          },
        });
        await deleteQueueItems([uploadingItem.id]);
        const currentStats = getBackupStats(uid);
        updateBackupStats(uid, {
          uploaded: currentStats.uploaded + 1,
          working: false,
          currentName: undefined,
          currentPercent: 0,
          lastRunAt: Date.now(),
          lastError: undefined,
        });
        emitBackupUpdate(uid);
      } catch (error: any) {
        const message = error?.message ?? 'Backup upload failed';
        await putQueueItems([{
          ...uploadingItem,
          status: 'failed',
          attempts: uploadingItem.attempts + 1,
          updatedAt: Date.now(),
          lastError: message,
        }]);
        updateBackupStats(uid, {
          working: false,
          currentName: undefined,
          currentPercent: 0,
          lastRunAt: Date.now(),
          lastError: message,
        });
        emitBackupUpdate(uid);
        break;
      }
    }
  } finally {
    const currentStats = getBackupStats(uid);
    if (currentStats.working) {
      updateBackupStats(uid, {
        working: false,
        currentName: undefined,
        currentPercent: 0,
      });
      emitBackupUpdate(uid);
    }
    runningWorkers.delete(uid);
  }
}

export function subscribeDeviceBackupUpdates(uid: string, callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onUpdate = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string }>).detail;
    if (!detail?.uid || detail.uid === uid) callback();
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.includes(uid)) callback();
  };
  window.addEventListener(UPDATE_EVENT, onUpdate as EventListener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(UPDATE_EVENT, onUpdate as EventListener);
    window.removeEventListener('storage', onStorage);
  };
}

async function startNativePhotoLibraryBackup(uid: string): Promise<NativeBackupResult> {
  if (typeof window === 'undefined') return { status: 'unavailable' };
  const capacitor = (window as any).Capacitor;
  const isNative = typeof capacitor?.isNativePlatform === 'function'
    ? capacitor.isNativePlatform()
    : capacitor?.platform === 'ios' || capacitor?.platform === 'android';
  const platform = typeof capacitor?.getPlatform === 'function' ? capacitor.getPlatform() : capacitor?.platform;

  // Android: custom CanactGallery plugin enumerates MediaStore and we
  // run the upload loop in JS. The actual scan is kicked off here and
  // also re-triggered on every app foreground by DeviceBackupWorker.
  if (isNative && platform === 'android') {
    const granted = await requestAndroidGalleryPermission();
    if (!granted) {
      return { status: 'error', message: 'Photo & video permission was denied. Enable it from system settings to continue.' };
    }
    // Fire and forget - the scan runs in the background. We don't await it
    // because it can take a long time on a large gallery.
    kickAndroidGalleryBackup(uid);
    return { status: 'active', message: 'Automated gallery backup is running in the background.' };
  }

  if (!isNative || platform !== 'ios') {
    return { status: 'unavailable', message: 'Automated gallery backup is only available in the CANACT mobile app.' };
  }

  const plugin = capacitor?.Plugins?.CanactDeviceBackup ?? capacitor?.Plugins?.DeviceBackup;
  if (!plugin?.startPhotoLibraryBackup) {
    return { status: 'unavailable', message: 'iOS PhotoKit backup plugin is not bundled yet.' };
  }

  try {
    const result = await plugin.startPhotoLibraryBackup({ uid });
    return { status: 'active', message: result?.message ?? 'iOS PhotoKit backup is active.' };
  } catch (error: any) {
    return { status: 'error', message: error?.message ?? 'iOS PhotoKit backup could not start.' };
  }
}

let kickedScans = new Set<string>();

/**
 * Trigger the Android automated gallery scan if it isn't already running.
 * Safe to call repeatedly - the underlying scan has its own per-uid lock.
 * Updates BackupStats so the UI shows live progress through the existing
 * DeviceMediaStatus pill / progress bar.
 */
export function kickAndroidGalleryBackup(uid: string): void {
  if (!isAndroidNative()) return;
  const settings = getDeviceBackupSettings(uid);
  if (!settings.enabled || settings.paused) return;
  if (kickedScans.has(uid)) return;
  kickedScans.add(uid);

  updateBackupStats(uid, {
    nativePhotoLibrary: 'active',
    nativeMessage: 'Scanning device gallery\u2026',
  });
  emitBackupUpdate(uid);

  runAndroidGalleryScan(uid, {
    isEnabled: () => {
      const current = getDeviceBackupSettings(uid);
      return current.enabled && !current.paused;
    },
    onProgress: ({ uploaded, currentName, currentPercent }) => {
      const stats = getBackupStats(uid);
      updateBackupStats(uid, {
        uploaded: Math.max(stats.uploaded, uploaded),
        working: !!currentName,
        currentName,
        currentPercent: currentPercent ?? 0,
      });
      emitBackupUpdate(uid);
    },
    onComplete: ({ uploaded, errors, scanned }) => {
      const stats = getBackupStats(uid);
      updateBackupStats(uid, {
        uploaded: Math.max(stats.uploaded, uploaded),
        working: false,
        currentName: undefined,
        currentPercent: 0,
        lastRunAt: Date.now(),
        lastError: errors > 0 ? `${errors} item${errors === 1 ? '' : 's'} failed to upload` : undefined,
        nativePhotoLibrary: 'active',
        nativeMessage: scanned === 0
          ? 'Gallery up to date.'
          : `Backed up ${uploaded} new item${uploaded === 1 ? '' : 's'}.`,
      });
      emitBackupUpdate(uid);
    },
  })
    .catch(() => {
      updateBackupStats(uid, {
        working: false,
        currentName: undefined,
        currentPercent: 0,
        nativePhotoLibrary: 'error',
        nativeMessage: 'Gallery scan failed - will retry next time you open the app.',
      });
      emitBackupUpdate(uid);
    })
    .finally(() => {
      kickedScans.delete(uid);
    });
}

export async function isAndroidGalleryGranted(): Promise<boolean> {
  return checkAndroidGalleryPermission();
}

export { isAndroidNative, resetAndroidGalleryProgress };

async function getNextQueueItem(uid: string): Promise<BackupQueueItem | null> {
  const items = await getAllQueueItems();
  const candidates = items
    .filter((item) => item.uid === uid)
    .filter((item) => item.status === 'pending' || item.status === 'uploading' || (item.status === 'failed' && item.attempts < MAX_ATTEMPTS))
    .sort((left, right) => left.createdAt - right.createdAt);
  return candidates[0] ?? null;
}

function getBackupStats(uid: string): BackupStats {
  return readJson(statsKey(uid), {
    uploaded: 0,
    working: false,
    currentPercent: 0,
    nativePhotoLibrary: 'unavailable',
  });
}

function updateBackupStats(uid: string, patch: Partial<BackupStats>): void {
  const current = getBackupStats(uid);
  writeJson(statsKey(uid), { ...current, ...patch });
}

function emitBackupUpdate(uid: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { uid } }));
}

function readJson<T extends Record<string, any>>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function settingsKey(uid: string): string {
  return `canact:backup:settings:${uid}`;
}

function statsKey(uid: string): string {
  return `canact:backup:stats:${uid}`;
}

function openQueueDb(): Promise<IDBDatabase> {
  if (!backupQueueStorageAvailable()) return Promise.reject(new Error('Backup queue unavailable'));
  if (queueDbPromise) return queueDbPromise;
  queueDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Backup queue open failed'));
    request.onblocked = () => reject(new Error('Backup queue blocked'));
  });
  return queueDbPromise;
}

async function withQueueStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openQueueDb();
  const transaction = db.transaction(QUEUE_STORE, mode);
  const done = transactionDone(transaction);
  const result = await run(transaction.objectStore(QUEUE_STORE));
  await done;
  return result;
}

function getAllQueueItems(): Promise<BackupQueueItem[]> {
  return withQueueStore('readonly', (store) => requestToPromise<BackupQueueItem[]>(store.getAll()));
}

function putQueueItems(items: BackupQueueItem[]): Promise<void> {
  return withQueueStore('readwrite', async (store) => {
    await Promise.all(items.map((item) => requestToPromise(store.put(item))));
  });
}

function deleteQueueItems(ids: string[]): Promise<void> {
  return withQueueStore('readwrite', async (store) => {
    await Promise.all(ids.map((id) => requestToPromise(store.delete(id))));
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Backup queue request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Backup queue transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Backup queue transaction failed'));
  });
}

function createQueueItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}