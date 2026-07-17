import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp } from '@/lib/server/firebaseAdmin';
import { verifyOtpChallenge } from '@/lib/server/otpChallenge';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { phone, otp, challenge } = (await request.json()) as { phone?: string; otp?: string; challenge?: string };
    if (!phone || !otp || !challenge || !/^\d{6}$/.test(otp) || !verifyOtpChallenge(challenge, phone, otp)) {
      return NextResponse.json({ ok: false, error: 'The code could not be verified.' }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    if (!app) {
      console.error('[OTP] Firebase Admin is not configured for fallback sign-in');
      return NextResponse.json({ ok: false, error: 'Verification is temporarily unavailable.' }, { status: 503 });
    }
    const adminAuth = getAuth(app);
    let user;
    let isNewUser = false;
    try {
      user = await adminAuth.getUserByPhoneNumber(phone);
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
      user = await adminAuth.createUser({ phoneNumber: phone });
      isNewUser = true;
    }
    const token = await adminAuth.createCustomToken(user.uid);
    return NextResponse.json({ ok: true, token, isNewUser });
  } catch (error) {
    console.error('[OTP] verify route failed', error);
    return NextResponse.json({ ok: false, error: 'The code could not be verified.' }, { status: 500 });
  }
}
