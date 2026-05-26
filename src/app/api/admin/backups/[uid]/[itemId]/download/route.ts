import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { getFirebaseAdminApp, verifyAdminRequest } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

type Params = {
  params: {
    uid: string;
    itemId: string;
  };
};

export async function GET(request: Request, { params }: Params) {
  const app = getFirebaseAdminApp();
  if (!app) return NextResponse.json({ ok: false, reason: 'admin-not-configured' }, { status: 503 });

  const admin = await verifyAdminRequest(request, app);
  if (!admin) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const uid = decodeURIComponent(params.uid || '');
  const itemId = decodeURIComponent(params.itemId || '');
  if (!uid || !itemId || /[.#$/[\]]/.test(uid) || /[.#$/[\]]/.test(itemId)) {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }

  const snap = await getDatabase(app).ref(`userBackups/${uid}/items/${itemId}`).get();
  const item = snap.val() as { pathname?: string; name?: string; contentType?: string } | null;
  if (!item?.pathname || !item.pathname.startsWith('backup/')) {
    return NextResponse.json({ ok: false, reason: 'not-found' }, { status: 404 });
  }

  const blob = await get(item.pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ ok: false, reason: 'blob-not-found' }, { status: 404 });
  }

  const filename = safeDownloadName(item.name || blob.blob.pathname.split('/').pop() || 'backup-file');
  return new Response(blob.stream, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': blob.blob.contentType || item.contentType || 'application/octet-stream',
      'Content-Length': String(blob.blob.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function safeDownloadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]+/g, '-').replace(/"/g, '').slice(0, 120) || 'backup-file';
}