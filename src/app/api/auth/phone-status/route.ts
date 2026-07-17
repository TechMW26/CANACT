import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp, verifyUserRequest } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { phone } = (await request.json()) as { phone?: string };
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    if (!app) return NextResponse.json({ ok: false }, { status: 503 });
    const verifiedUser = await verifyUserRequest(request, app);
    if (!verifiedUser) return NextResponse.json({ ok: false }, { status: 401 });

    try {
      const owner = await getAuth(app).getUserByPhoneNumber(phone);
      return NextResponse.json({
        ok: true,
        status: owner.uid === verifiedUser.uid ? 'current' : 'other',
      });
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
      return NextResponse.json({ ok: true, status: 'available' });
    }
  } catch (error) {
    console.error('[OTP] phone ownership check failed', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
