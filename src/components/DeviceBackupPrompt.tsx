'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  BACKUP_DOCUMENT_ACCEPT,
  BACKUP_MEDIA_ACCEPT,
  MAX_BACKUP_FILE_BYTES,
  backupFileProblem,
  uploadBackupFile,
  type BackupUploadProgress,
} from '@/lib/deviceBackup';
import { Button } from './Button';
import { Modal } from './Modal';
import { toast } from './Toaster';
import { CheckCircle2, CloudUpload, X } from './icons';

const BACKUP_PROMPT_VERSION = 'v1';

type UploadState = {
  total: number;
  done: number;
  failed: number;
  currentName: string;
  currentPercent: number;
};

export function DeviceBackupPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const key = backupPromptKey(user.uid);
      if (!localStorage.getItem(key)) setOpen(true);
    } catch {}
  }, [user?.uid]);

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
      title="Cloud backup"
      footer={(
        <>
          <button
            type="button"
            className="rounded-full border border-line bg-white px-4 h-10 text-ink"
            onClick={() => {
              rememberChoice('dismissed');
              setOpen(false);
            }}
          >
            Skip
          </button>
          <DeviceBackupPicker
            uid={user.uid}
            label="Choose files"
            onStarted={() => rememberChoice('enabled')}
            onFinished={() => setOpen(false)}
          />
        </>
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-2xl bg-brand-light/70 p-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
            <CloudUpload size={19} strokeWidth={2.2} />
          </span>
          <div>
            <p className="text-sm font-extrabold text-ink">Back up selected photos, videos, and documents to Canact storage.</p>
            <p className="mt-1 text-xs leading-5 text-ink/65">On iOS, selected Photos library items upload as soon as the system picker returns them. Photo permission alone will not copy your full library.</p>
          </div>
        </div>
        <ul className="space-y-2 text-xs text-ink/65">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Private blob storage path under your account.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Supports common images, videos, PDFs, text files, and Office docs.</li>
          <li className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> Device-wide automatic document scraping is not available from the web permission flow.</li>
        </ul>
      </div>
    </Modal>
  );
}

export function DeviceBackupSettingsControl({ uid }: { uid: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
          <CloudUpload size={19} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-ink">Cloud backup</div>
          <p className="mt-1 text-xs leading-5 text-ink/60">Choose photos, videos, and documents to store in your private Canact blob backup.</p>
          <div className="mt-3">
            <DeviceBackupPicker uid={uid} label="Choose files to back up" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceBackupPicker({
  uid,
  label,
  onStarted,
  onFinished,
}: {
  uid: string;
  label: string;
  onStarted?: () => void;
  onFinished?: () => void;
}) {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<UploadState>({ total: 0, done: 0, failed: 0, currentName: '', currentPercent: 0 });

  const onFiles = async (selected: File[]) => {
    if (!selected.length || uploading) return;
    const files = selected.filter((file) => !backupFileProblem(file));
    const skipped = selected.length - files.length;
    if (!files.length) {
      toast(skipped ? `No supported files under ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} MB` : 'No files selected', 'error');
      return;
    }

    onStarted?.();
    setUploading(true);
    setState({ total: files.length, done: 0, failed: 0, currentName: files[0]?.name ?? '', currentPercent: 0 });

    let done = 0;
    let failed = 0;
    for (const file of files) {
      setState((current) => ({ ...current, currentName: file.name || 'file', currentPercent: 0 }));
      try {
        await uploadBackupFile(file, {
          uid,
          onProgress: (progress: BackupUploadProgress) => {
            setState((current) => ({ ...current, currentPercent: Math.round(progress.percentage || 0) }));
          },
        });
        done += 1;
      } catch {
        failed += 1;
      }
      setState((current) => ({ ...current, done, failed }));
    }

    setUploading(false);
    if (failed) toast(`Backed up ${done} file${done === 1 ? '' : 's'}; ${failed} failed`, done ? 'info' : 'error');
    else toast(`Backed up ${done} file${done === 1 ? '' : 's'}`, 'success');
    if (skipped) toast(`Skipped ${skipped} unsupported or oversized file${skipped === 1 ? '' : 's'}`, 'info');
    onFinished?.();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    onFiles(files).catch(() => toast('Backup failed', 'error'));
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
          icon={!uploading ? <CloudUpload size={17} strokeWidth={2.3} /> : undefined}
          loading={uploading}
          disabled={uploading}
          onClick={() => mediaInputRef.current?.click()}
        >
          {uploading ? `${state.done}/${state.total}` : 'Photos & videos'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={() => documentInputRef.current?.click()}
        >
          {label}
        </Button>
      </div>
      {uploading && (
        <div className="min-w-[220px] space-y-1 text-xs text-ink/60">
          <div className="flex items-center justify-between gap-3">
            <span className="max-w-[160px] truncate">{state.currentName}</span>
            <span>{state.currentPercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(3, state.currentPercent)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function backupPromptKey(uid: string): string {
  return `canact:backup:${BACKUP_PROMPT_VERSION}:${uid}`;
}