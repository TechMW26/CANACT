'use client';

import { upload } from '@vercel/blob/client';
import { push, ref, set } from 'firebase/database';
import { db } from '@/lib/firebase';

export type BackupUploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type BackupUploadResult = {
  id: string | null;
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  size: number;
  name: string;
};

export const MAX_BACKUP_FILE_BYTES = 80 * 1024 * 1024;

export const BACKUP_MEDIA_ACCEPT = [
  'image/*',
  'video/*',
].join(',');

export const BACKUP_DOCUMENT_ACCEPT = [
  'application/pdf',
  'text/plain',
  'text/rtf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.pages',
  'application/vnd.apple.numbers',
  'application/vnd.apple.keynote',
  '.pages',
  '.numbers',
  '.key',
].join(',');

export const BACKUP_FILE_ACCEPT = [BACKUP_MEDIA_ACCEPT, BACKUP_DOCUMENT_ACCEPT].join(',');

const SUPPORTED_BACKUP_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'application/pdf',
  'text/plain',
  'text/rtf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.pages',
  'application/vnd.apple.numbers',
  'application/vnd.apple.keynote',
]);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  pdf: 'application/pdf',
  txt: 'text/plain',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
  key: 'application/vnd.apple.keynote',
};

export function backupFileProblem(file: File): string | null {
  if (file.size <= 0) return 'empty';
  if (file.size > MAX_BACKUP_FILE_BYTES) return 'too-large';
  return backupFileContentType(file) ? null : 'unsupported';
}

export function backupFileContentType(file: File): string | null {
  const explicitType = (file.type || '').split(';')[0].trim().toLowerCase();
  if (explicitType && SUPPORTED_BACKUP_MIME.has(explicitType)) return explicitType;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] ?? null : null;
}

export async function uploadBackupFile(
  file: File,
  opts: { uid: string; onProgress?: (progress: BackupUploadProgress) => void },
): Promise<BackupUploadResult> {
  const contentType = backupFileContentType(file);
  if (!contentType) throw new Error('Unsupported file type');
  if (file.size <= 0) throw new Error('File is empty');
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error(`File too large. Limit is ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} MB.`);

  const pathname = `backup/${safePathSegment(opts.uid)}/${Date.now()}-${randomId()}-${safeFilename(file.name, contentType)}`;
  const blob = await upload(pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/blob/upload',
    contentType,
    multipart: file.size > 8 * 1024 * 1024,
    clientPayload: JSON.stringify({ purpose: 'device-backup', uid: opts.uid }),
    onUploadProgress: opts.onProgress,
  });

  const itemRef = push(ref(db, `userBackups/${opts.uid}/items`));
  const record = {
    name: file.name || 'file',
    size: file.size,
    contentType: blob.contentType || contentType,
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    pathname: blob.pathname,
    access: 'private',
    createdAt: Date.now(),
  };
  await set(itemRef, record);

  return {
    id: itemRef.key,
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    pathname: blob.pathname,
    contentType: record.contentType,
    size: file.size,
    name: file.name || 'file',
  };
}

function safePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '-').slice(0, 96) || 'user';
}

function safeFilename(name: string, contentType: string): string {
  const fallback = `file.${extForMime(contentType)}`;
  const base = (name || fallback)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!base) return fallback;
  return base.includes('.') ? base : `${base}.${extForMime(contentType)}`;
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    case 'image/gif': return 'gif';
    case 'video/mp4': return 'mp4';
    case 'video/webm': return 'webm';
    case 'video/quicktime': return 'mov';
    case 'video/x-m4v': return 'm4v';
    case 'application/pdf': return 'pdf';
    case 'text/plain': return 'txt';
    case 'text/rtf':
    case 'application/rtf': return 'rtf';
    case 'application/msword': return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
    case 'application/vnd.ms-excel': return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx';
    case 'application/vnd.ms-powerpoint': return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return 'pptx';
    case 'application/vnd.apple.pages': return 'pages';
    case 'application/vnd.apple.numbers': return 'numbers';
    case 'application/vnd.apple.keynote': return 'key';
    default: return 'bin';
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 12);
}