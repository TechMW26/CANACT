import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import {
  getFirebaseAdminApp,
  patchUserRtdb,
  readAdminRtdb,
  verifyUserRequest,
} from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other']);
const DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const SELFIE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type StoredVerificationFile = {
  url: string;
  pathname: string;
  name: string;
  type: string;
  size: number;
};

function extensionFor(file: File) {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function validateFile(file: File | null, allowedTypes: Set<string>, label: string, required = true) {
  if (!file || file.size === 0) {
    if (required) throw new Error(`${label} is required.`);
    return;
  }
  if (!allowedTypes.has(file.type)) throw new Error(`${label} has an unsupported file type.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${label} must be smaller than 10 MB.`);
}

async function storeFile(
  bucket: ReturnType<typeof getStorage> extends { bucket: (...args: any[]) => infer T } ? T : never,
  uid: string,
  requestId: string,
  slot: string,
  file: File,
): Promise<StoredVerificationFile> {
  const pathname = `verification/${uid}/${requestId}/${slot}.${extensionFor(file)}`;
  const downloadToken = randomUUID();
  const stored = bucket.file(pathname);
  await stored.save(Buffer.from(await file.arrayBuffer()), {
    resumable: false,
    contentType: file.type,
    metadata: {
      cacheControl: 'private, max-age=0, no-store',
      metadata: { firebaseStorageDownloadTokens: downloadToken, verificationOwner: uid },
    },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(pathname)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
  return { url, pathname, name: file.name, type: file.type, size: file.size };
}

export async function POST(req: Request) {
  const app = getFirebaseAdminApp();
  const authenticated = await verifyUserRequest(req, app);
  if (!authenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!app) return NextResponse.json({ error: 'Secure document storage is not configured.' }, { status: 503 });

  try {
    const [profile, previous] = await Promise.all([
      readAdminRtdb<any>(`users/${authenticated.uid}`, app, authenticated.idToken),
      readAdminRtdb<any>(`verificationRequests/${authenticated.uid}`, app, authenticated.idToken),
    ]);
    if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    if (profile.profileVerified || previous?.status === 'approved') {
      return NextResponse.json({ error: 'This profile is already verified.' }, { status: 409 });
    }
    if (previous?.status === 'pending') {
      return NextResponse.json({ error: 'Your verification request is already under review.' }, { status: 409 });
    }
    const now = Date.now();
    if (previous?.status === 'rejected' && Number(previous.cooldownUntil || 0) > now) {
      return NextResponse.json({
        error: 'You can reapply after the 15-day cooldown.',
        cooldownUntil: previous.cooldownUntil,
      }, { status: 429 });
    }

    const form = await req.formData();
    const documentType = String(form.get('documentType') || '').trim();
    if (!DOCUMENT_TYPES.has(documentType)) return NextResponse.json({ error: 'Select a valid document type.' }, { status: 400 });

    const documentFront = form.get('documentFront') instanceof File ? form.get('documentFront') as File : null;
    const documentBack = form.get('documentBack') instanceof File ? form.get('documentBack') as File : null;
    const selfie = form.get('selfie') instanceof File ? form.get('selfie') as File : null;
    validateFile(documentFront, DOCUMENT_MIME_TYPES, 'Document front');
    validateFile(documentBack, DOCUMENT_MIME_TYPES, 'Document back', false);
    validateFile(selfie, SELFIE_MIME_TYPES, 'Verification selfie');

    const requestId = `manual_${now}_${randomUUID()}`;
    const bucket = getStorage(app).bucket();
    const uploaded: StoredVerificationFile[] = [];
    try {
      uploaded.push(await storeFile(bucket, authenticated.uid, requestId, 'document-front', documentFront!,));
      if (documentBack) uploaded.push(await storeFile(bucket, authenticated.uid, requestId, 'document-back', documentBack));
      uploaded.push(await storeFile(bucket, authenticated.uid, requestId, 'selfie', selfie!));
    } catch (error) {
      await Promise.allSettled(uploaded.map((item) => bucket.file(item.pathname).delete()));
      throw error;
    }

    const files = {
      documentFront: uploaded.find((item) => item.pathname.includes('document-front')),
      documentBack: uploaded.find((item) => item.pathname.includes('document-back')) ?? null,
      selfie: uploaded.find((item) => item.pathname.includes('selfie')),
    };
    const requestRecord = {
      requestId,
      uid: authenticated.uid,
      documentType,
      files,
      status: 'pending',
      submittedAt: now,
      updatedAt: now,
    };
    const updates: Record<string, unknown> = {
      [`verificationRequests/${authenticated.uid}`]: requestRecord,
      [`users/${authenticated.uid}/verificationStatus`]: 'pending',
      [`users/${authenticated.uid}/verificationSubmittedAt`]: now,
      [`users/${authenticated.uid}/verificationRejectedAt`]: null,
      [`users/${authenticated.uid}/verificationCooldownUntil`]: null,
      [`users/${authenticated.uid}/verificationRejectionReason`]: null,
    };
    if (previous?.requestId) updates[`verificationRequestHistory/${authenticated.uid}/${previous.requestId}`] = previous;
    await patchUserRtdb('', updates, app, authenticated.idToken);

    return NextResponse.json({ ok: true, requestId, status: 'pending', submittedAt: now });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Could not submit verification request.' }, { status: 400 });
  }
}
