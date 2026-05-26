'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  BACKUP_MEDIA_ACCEPT,
  MAX_BACKUP_FILE_BYTES,
} from '@/lib/deviceBackup';
import {
  clearLocalBackupQueue,
  defaultDeviceBackupSummary,
  enableDeviceBackup,
  enqueueBackupFiles,
  getDeviceBackupSummary,
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

const BACKUP_PROMPT_VERSION = 'v1';

export function DeviceBackupPrompt() {
  const { user } = useAuth();
  const summary = useDeviceBackupSummary(user?.uid ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const key = backupPromptKey(user.uid);
      if (!localStorage.getItem(key) && !summary.enabled) setOpen(true);
    } catch {}
  }, [summary.enabled, user?.uid]);

  if (!user) return null;

  const rememberChoice = (choice: 'enabled' | 'dismissed') => {
    try { localStorage.setItem(backupPromptKey(user.uid), choice); } catch {}
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        rememberChoice('dismissed');
        setOpen(false);
      }}
      title="Media Access"
    >
      <div className="space-y-3">
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
      </div>
    </Modal>
  );
}

export function DeviceBackupSettingsControl({ uid }: { uid: string }) {
  const summary = useDeviceBackupSummary(uid);

  const turnOnMediaAccess = async () => {
    const native = await enableDeviceBackup(uid);
    if (native.status === 'error') toast('Media access enabled', 'info');
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
    const kick = () => {
      if (cancelled) return;
      processDeviceBackupQueue(uid).catch(() => {});
    };
    kick();
    const unsubscribe = subscribeDeviceBackupUpdates(uid, kick);
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', onVisible);
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
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
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
        ref={mediaInputRef}
        type="file"
        accept={BACKUP_MEDIA_ACCEPT}
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
          onClick={() => mediaInputRef.current?.click()}
        >
          Select Photos & Videos
        </Button>
      </div>
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