'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  BACKUP_DOCUMENT_ACCEPT,
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
import { CheckCircle2, CloudUpload, X } from './icons';

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

  const turnOnAutomaticBackup = async () => {
    rememberChoice('enabled');
    const native = await enableDeviceBackup(user.uid);
    if (native.status === 'error') toast('Automatic backup is on; native iOS sync could not start', 'info');
    else toast('Automatic backup is on', 'success');
    processDeviceBackupQueue(user.uid).catch(() => {});
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        rememberChoice('dismissed');
        setOpen(false);
      }}
      title="Cloud backup"
      footer={(
        <button
          type="button"
          className="rounded-full border border-line bg-white px-4 h-10 text-ink"
          onClick={() => {
            rememberChoice(summary.enabled ? 'enabled' : 'dismissed');
            setOpen(false);
          }}
        >
          {summary.enabled ? 'Done' : 'Skip'}
        </button>
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-2xl bg-brand-light/70 p-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
            <CloudUpload size={19} strokeWidth={2.2} />
          </span>
          <div>
            <p className="text-sm font-extrabold text-ink">Turn on automatic backup for selected photos, videos, and documents.</p>
            <p className="mt-1 text-xs leading-5 text-ink/65">After you opt in, chosen items are queued locally and upload automatically in the background.</p>
          </div>
        </div>
        <ul className="space-y-2 text-xs text-ink/65">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Private blob storage path under your account.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Queue keeps working while the app stays open and resumes on the next launch.</li>
          <li className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> Full-library iOS PhotoKit sync needs the native plugin; this build queues selected items.</li>
        </ul>
        {summary.enabled ? (
          <div className="space-y-3">
            <DeviceBackupStatus summary={summary} />
            <DeviceBackupPicker uid={user.uid} onQueued={() => setOpen(false)} />
          </div>
        ) : (
          <Button full icon={<CloudUpload size={17} strokeWidth={2.3} />} onClick={turnOnAutomaticBackup}>
            Turn on automatic backup
          </Button>
        )}
      </div>
    </Modal>
  );
}

export function DeviceBackupSettingsControl({ uid }: { uid: string }) {
  const summary = useDeviceBackupSummary(uid);

  const turnOnAutomaticBackup = async () => {
    const native = await enableDeviceBackup(uid);
    if (native.status === 'error') toast('Automatic backup is on; native iOS sync could not start', 'info');
    else toast('Automatic backup is on', 'success');
    processDeviceBackupQueue(uid).catch(() => {});
  };

  const turnOffAutomaticBackup = async () => {
    setDeviceBackupEnabled(uid, false);
    await clearLocalBackupQueue(uid);
    toast('Automatic backup is off', 'info');
  };

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
          <CloudUpload size={19} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-extrabold text-ink">Automatic cloud backup</div>
            <BackupStatePill summary={summary} />
          </div>
          <p className="mt-1 text-xs leading-5 text-ink/60">Queue photos, videos, and documents once; Canact backs them up automatically while the app is open.</p>
          <div className="mt-3 space-y-3">
            <DeviceBackupStatus summary={summary} />
            <div className="flex flex-wrap gap-2">
              {!summary.enabled ? (
                <Button size="sm" icon={<CloudUpload size={15} strokeWidth={2.3} />} onClick={turnOnAutomaticBackup}>Turn on</Button>
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
                  <Button size="sm" variant="ghost" onClick={turnOffAutomaticBackup}>Turn off</Button>
                </>
              )}
            </div>
            {summary.enabled && <DeviceBackupPicker uid={uid} />}
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

function DeviceBackupPicker({
  uid,
  onQueued,
}: {
  uid: string;
  onQueued?: () => void;
}) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [queuing, setQueuing] = useState(false);

  const onFiles = async (selected: File[]) => {
    if (!selected.length || queuing) return;
    setQueuing(true);
    try {
      const result = await enqueueBackupFiles(uid, selected);
      if (result.storageUnavailable) {
        toast('Automatic backup queue is not available on this browser', 'error');
        return;
      }
      if (result.queued) {
        toast(`Queued ${result.queued} file${result.queued === 1 ? '' : 's'} for backup`, 'success');
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
      toast('Could not queue backup files', 'error');
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
      <input
        ref={documentInputRef}
        type="file"
        accept={BACKUP_DOCUMENT_ACCEPT}
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
          Photos & videos
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={queuing}
          onClick={() => documentInputRef.current?.click()}
        >
          Documents
        </Button>
      </div>
    </div>
  );
}

function DeviceBackupStatus({ summary }: { summary: DeviceBackupSummary }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 text-xs text-ink/65">
      <div className="flex flex-wrap items-center gap-2">
        <BackupStatePill summary={summary} />
        <span>{summary.uploaded} backed up</span>
        <span>{summary.pending + summary.uploading} queued</span>
        {summary.failed > 0 && <span className="font-bold text-brand">{summary.failed} needs retry</span>}
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

function BackupStatePill({ summary }: { summary: DeviceBackupSummary }) {
  const label = !summary.enabled ? 'Off' : summary.paused ? 'Paused' : summary.working ? 'Backing up' : 'On';
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