import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Allowed app media MIME types for direct uploads. */
const MEDIA_ALLOWED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

const MAX_BYTES = 80 * 1024 * 1024; // 80 MB

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, _clientPayload) => {
        if (!isSafePathname(pathname)) throw new Error('Invalid upload path');
        // NOTE: matches the project's existing open-rules posture (no admin
        // SDK wired yet). Tighten later with firebase-admin token verification.
        return {
          allowedContentTypes: MEDIA_ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        /* no-op */
      },
    });
    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Upload failed' }, { status: 400 });
  }
}

function isSafePathname(pathname: string): boolean {
  return !!pathname && !pathname.startsWith('/') && !pathname.includes('..') && pathname.length <= 240;
}
