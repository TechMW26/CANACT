'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  MAX_BACKUP_FILE_BYTES,
} from '@/lib/deviceBackup';
import {
  clearLocalBackupQueue,
  defaultDeviceBackupSummary,
  enableDeviceBackup,
  enqueueBackupFiles,
  getDeviceBackupSummary,
  isAndroidGalleryGranted,
  isAndroidNative,
  kickAndroidGalleryBackup,
  processDeviceBackupQueue,
  setDeviceBackupEnabled,
  setDeviceBackupPaused,
  subscribeDeviceBackupUpdates,
  type DeviceBackupSummary,
} from '@/lib/deviceBackupQueue';
import { Button } from './Button';
import { Modal } from './Modal';
import { toast } from './Toaster';
import { CloudUpload } from './icons';

const BACKUP_PROMPT_VERSION = 'v2';

export function DeviceBackupPrompt() {
  const { user } = useAuth();
  const summary = useDeviceBackupSummary(user?.uid ?? null);
  const [open, setOpen] = useState(false);
  const [androidNative, setAndroidNative] = useState(false);
  const [isCheckingAndroidPermission, setIsCheckingAndroidPermission] = useState(true);
  const [isEnabling, setIsEnabling] = useState(false);
  const lastPermissionPromptAtRef = useRef(0);

  useEffect(() => {
    setAndroidNative(isAndroidNative());
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setIsCheckingAndroidPermission(false);
      return;
    }

    if (androidNative) {
      setIsCheckingAndroidPermission(true);
      isAndroidGalleryGranted()
        .then((granted) => {
          if (cancelled) return;
          setOpen(!granted);
        })
        .catch(() => {
          if (cancelled) return;
          setOpen(true);
        })
        .finally(() => {
          if (!cancelled) setIsCheckingAndroidPermission(false);
        });
      return () => { cancelled = true; };
    }

    setIsCheckingAndroidPermission(false);
    try {
      const key = backupPromptKey(user.uid);
      if (!localStorage.getItem(key) && !summary.enabled) setOpen(true);
    } catch {}
    return () => { cancelled = true; };
  }, [androidNative, summary.enabled, user?.uid]);

  if (!user) return null;

  const rememberChoice = (choice: 'enabled' | 'dismissed') => {
    try { localStorage.setItem(backupPromptKey(user.uid), choice); } catch {}
  };

  const ensureAndroidPermission = useCallback(async (opts?: { prompt?: boolean; notifyOnFailure?: boolean; notifyOnSuccess?: boolean }) => {
    if (!user || !androidNative) return false;

    const alreadyGranted = await isAndroidGalleryGranted().catch(() => false);
    if (alreadyGranted) {
      rememberChoice('enabled');
      setOpen(false);
      return true;
    }

    setOpen(true);
    if (!opts?.prompt || isEnabling) return false;

    const now = Date.now();
    // Prevent noisy back-to-back permission dialogs on focus/visibility churn.
    if (now - lastPermissionPromptAtRef.current < 9000) return false;
    lastPermissionPromptAtRef.current = now;

    setIsEnabling(true);
    try {
      const native = await enableDeviceBackup(user.uid);
      const granted = await isAndroidGalleryGranted().catch(() => false);
      if (!granted) {
        if (opts?.notifyOnFailure) {
          toast(native.message ?? 'Please allow photo and video access to continue.', 'error');
        }
        setOpen(true);
        return false;
      }

      rememberChoice('enabled');
      setOpen(false);
      if (opts?.notifyOnSuccess) {
        toast('Automated gallery backup is on', 'success');
      }
      return true;
    } finally {
      setIsEnabling(false);
    }
  }, [androidNative, isEnabling, user]);

  const acceptAutomatedBackup = useCallback(async () => {
    await ensureAndroidPermission({ prompt: true, notifyOnFailure: true, notifyOnSuccess: true });
  }, [ensureAndroidPermission]);

  useEffect(() => {
    if (!androidNative || !user || !open) return;
    // If permission is still missing, keep requesting until granted.
    const timer = window.setTimeout(() => {
      ensureAndroidPermission({ prompt: true });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [androidNative, ensureAndroidPermission, open, user?.uid]);

  useEffect(() => {
    if (!androidNative || !user) return;

    const kick = () => {
      ensureAndroidPermission({ prompt: true });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };

    window.addEventListener('focus', kick);
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);

    let removeNative: (() => void) | null = null;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) kick();
        });
        removeNative = () => handle.remove();
      } catch {}
    })();

    return () => {
      window.removeEventListener('focus', kick);
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
      removeNative?.();
    };
  }, [androidNative, ensureAndroidPermission, user?.uid]);

  if (androidNative && isCheckingAndroidPermission) return null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (androidNative) {
          setOpen(true);
          return;
        }
        rememberChoice('dismissed');
        setOpen(false);
      }}
      title={androidNative ? 'Automated Photo & Video Backup' : 'Media Access'}
    >
      <div className="space-y-3">
        {androidNative ? (
          // Google Play Photo & Video Permissions Policy (Aug 2024) requires
          // a prominent, in-app disclosure of *what* data is accessed and
          // *why* before the runtime permission dialog is shown. This block
          // is that disclosure - do not remove or hide it.
          <>
            <div className="flex items-start gap-3 rounded-2xl bg-brand-light/70 p-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
                <CloudUpload size={19} strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-sm font-extrabold text-ink">
                  Continuously back up your photos & videos.
                </p>
                <p className="mt-1 text-xs leading-5 text-ink/65">
                  CANACT will read every photo and video in your device gallery
                  and upload them to your private CANACT cloud backup so they
                  are safe if you lose your phone. New captures are picked up
                  automatically every time you open the app.
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 rounded-2xl border border-line bg-white p-3 text-[12px] leading-5 text-ink/70">
              <li><span className="font-bold text-ink">What is accessed:</span> all photos and videos on your device, including their file name, size, type and creation date.</li>
              <li><span className="font-bold text-ink">Where it goes:</span> uploaded to your private CANACT cloud storage. Only you and CANACT support can access it.</li>
              <li><span className="font-bold text-ink">Shared with third parties:</span> no.</li>
              <li><span className="font-bold text-ink">Control:</span> pause or turn off automated backup anytime from Settings &rarr; Media Access.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={acceptAutomatedBackup} icon={<CloudUpload size={17} strokeWidth={2.3} />} disabled={isEnabling}>
                {isEnabling ? 'Requesting permission...' : 'Allow & Start Backup'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-2xl bg-brand-light/70 p-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
                <CloudUpload size={19} strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-sm font-extrabold text-ink">
                  Allow media access.
                </p>
                <p className="mt-1 text-xs leading-5 text-ink/65">
                  This is required to post photos and videos in the app.
                </p>
              </div>
            </div>

            {summary.enabled ? (
              <div className="space-y-3">
                <DeviceMediaStatus summary={summary} />
                <DeviceMediaPicker uid={user.uid} onQueued={() => setOpen(false)} />
              </div>
            ) : (
              <DeviceMediaPicker
                uid={user.uid}
                autoEnable
                onQueued={() => {
                  rememberChoice('enabled');
                  setOpen(false);
                }}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function DeviceBackupSettingsControl({ uid }: { uid: string }) {
  const summary = useDeviceBackupSummary(uid);

  const turnOnMediaAccess = async () => {
    const native = await enableDeviceBackup(uid);
    if (native.status === 'error') toast(native.message ?? 'Media access not granted yet', 'error');
    else toast('Media access enabled', 'success');
    processDeviceBackupQueue(uid).catch(() => {});
  };

  const turnOffMediaAccess = async () => {
    setDeviceBackupEnabled(uid, false);
    await clearLocalBackupQueue(uid);
    toast('Media access disabled', 'info');
  };

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
          <CloudUpload size={19} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-extrabold text-ink">Media Access for Posting</div>
            <MediaStatePill summary={summary} />
          </div>
          <p className="mt-1 text-xs leading-5 text-ink/60">
            Allow media access to be used when posting in the app.
          </p>
          <div className="mt-3 space-y-3">
            <DeviceMediaStatus summary={summary} />
            <div className="flex flex-wrap gap-2">
              {!summary.enabled ? (
                <Button size="sm" icon={<CloudUpload size={15} strokeWidth={2.3} />} onClick={turnOnMediaAccess}>
                  Enable Media Access
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDeviceBackupPaused(uid, !summary.paused);
                      if (summary.paused) processDeviceBackupQueue(uid).catch(() => {});
                    }}
                  >
                    {summary.paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={turnOffMediaAccess}>Disable</Button>
                </>
              )}
            </div>
            {summary.enabled && <DeviceMediaPicker uid={uid} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeviceBackupWorker({ uid }: { uid: string }) {
  useEffect(() => {
    let cancelled = false;
    let nativeListener: { remove: () => void } | null = null;

    const kick = () => {
      if (cancelled) return;
      processDeviceBackupQueue(uid).catch(() => {});
      // Drive the Android automated gallery scan on every kick. The function
      // is a no-op on non-Android-native surfaces and self-locks per uid so
      // overlapping kicks coalesce into a single scan.
      try { kickAndroidGalleryBackup(uid); } catch {}
    };

    kick();
    const unsubscribe = subscribeDeviceBackupUpdates(uid, kick);
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', onVisible);

    // On Capacitor Android, the WebView does not always fire visibility /
    // focus when the user returns to the app from another app. Hook into
    // the native App.appStateChange event so the gallery scan re-runs as
    // soon as the user foregrounds CANACT.
    if (isAndroidNative()) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          if (cancelled) return;
          const handle = await App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) kick();
          });
          if (cancelled) {
            handle.remove();
            return;
          }
          nativeListener = handle;
        } catch {}
      })();
    }

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', onVisible);
      if (nativeListener) {
        try { nativeListener.remove(); } catch {}
      }
    };
  }, [uid]);

  return null;
}

function DeviceMediaPicker({
  uid,
  onQueued,
  autoEnable = false,
}: {
  uid: string;
  onQueued?: () => void;
  autoEnable?: boolean;
}) {
  // NOTE: iOS Safari/WKWebView shows the "Photo Library / Take Photo / Choose Files"
  // action sheet whenever a single file input accepts both image/* and video/*.
  // Splitting into one input per type makes the OS open the Photo Library multi-select
  // grid directly so the user can "select all" photos or videos with checkmarks.
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const videosInputRef = useRef<HTMLInputElement | null>(null);
  const [queuing, setQueuing] = useState(false);

  const onFiles = async (selected: File[]) => {
    if (!selected.length || queuing) return;
    setQueuing(true);
    try {
      if (autoEnable) {
        const native = await enableDeviceBackup(uid);
        if (native.status === 'error') toast('Media access enabled', 'info');
      }
      const result = await enqueueBackupFiles(uid, selected);
      if (result.storageUnavailable) {
        toast('Media access is not available on this browser', 'error');
        return;
      }
      if (result.queued) {
        toast(`Added ${result.queued} file${result.queued === 1 ? '' : 's'} for posting`, 'success');
        onQueued?.();
        processDeviceBackupQueue(uid).catch(() => {});
      } else {
        toast(result.skipped ? `No supported files under ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} MB` : 'No files selected', 'error');
      }
      if (result.skipped) toast(`Skipped ${result.skipped} unsupported or oversized file${result.skipped === 1 ? '' : 's'}`, 'info');
    } finally {
      setQueuing(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    onFiles(files).catch(() => {
      toast('Could not add files', 'error');
    });
  };

  return (
    <div className="space-y-2">
      <input
        ref={photosInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />
      <input
        ref={videosInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          icon={!queuing ? <CloudUpload size={17} strokeWidth={2.3} /> : undefined}
          loading={queuing}
          disabled={queuing}
          onClick={() => photosInputRef.current?.click()}
        >
          Allow Photos
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={queuing}
          disabled={queuing}
          onClick={() => videosInputRef.current?.click()}
        >
          Allow Videos
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-ink/55">
        Tap a button to open your library. Use the checkmarks to select all the items you want at once.
      </p>
    </div>
  );
}

function DeviceMediaStatus({ summary }: { summary: DeviceBackupSummary }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 text-xs text-ink/65">
      <div className="flex flex-wrap items-center gap-2">
        <MediaStatePill summary={summary} />
        <span>{summary.uploaded} ready</span>
        <span>{summary.pending + summary.uploading} selected</span>
        {summary.failed > 0 && <span className="font-bold text-brand">{summary.failed} needs attention</span>}
      </div>
      {summary.working && summary.currentName && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="max-w-[180px] truncate">{summary.currentName}</span>
            <span>{summary.currentPercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(3, summary.currentPercent)}%` }} />
          </div>
        </div>
      )}
      {summary.lastError && <p className="mt-2 text-brand">{summary.lastError}</p>}
      {summary.nativeMessage && <p className="mt-2">{summary.nativeMessage}</p>}
      {summary.lastRunAt && <p className="mt-2">Last activity {formatLastRun(summary.lastRunAt)}</p>}
    </div>
  );
}

function MediaStatePill({ summary }: { summary: DeviceBackupSummary }) {
  const label = !summary.enabled ? 'Off' : summary.paused ? 'Paused' : summary.working ? 'Processing' : 'Enabled';
  const className = !summary.enabled
    ? 'bg-ink/10 text-ink/60'
    : summary.paused
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-100 text-emerald-800';
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${className}`}>{label}</span>;
}

function useDeviceBackupSummary(uid: string | null): DeviceBackupSummary {
  const [summary, setSummary] = useState<DeviceBackupSummary>(() => defaultDeviceBackupSummary());

  useEffect(() => {
    if (!uid) {
      setSummary(defaultDeviceBackupSummary());
      return;
    }
    let active = true;
    const refresh = () => {
      getDeviceBackupSummary(uid).then((next) => {
        if (active) setSummary(next);
      }).catch(() => {
        if (active) setSummary(defaultDeviceBackupSummary());
      });
    };
    refresh();
    const unsubscribe = subscribeDeviceBackupUpdates(uid, refresh);
    const timer = window.setInterval(refresh, 8_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [uid]);

  return summary;
}

function formatLastRun(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function backupPromptKey(uid: string): string {
  return `canact:backup:${BACKUP_PROMPT_VERSION}:${uid}`;
}