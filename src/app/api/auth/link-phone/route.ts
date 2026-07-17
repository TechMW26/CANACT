import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirebaseAdminApp, verifyUserRequest } from '@/lib/server/firebaseAdmin';
import { verifyOtpChallenge } from '@/lib/server/otpChallenge';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { phone, otp, challenge } = (await request.json()) as {
      phone?: string;
      otp?: string;
      challenge?: string;
    };
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !otp || !/^\d{6}$/.test(otp) || !challenge) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    if (!app) {
      console.error('[OTP] Firebase Admin is not configured for phone linking');
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    const verifiedUser = await verifyUserRequest(request, app);
    if (!verifiedUser) return NextResponse.json({ ok: false }, { status: 401 });
    if (!verifyOtpChallenge(challenge, phone, otp)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const adminAuth = getAuth(app);
    try {
      const owner = await adminAuth.getUserByPhoneNumber(phone);
      if (owner.uid !== verifiedUser.uid) {
        const token = await adminAuth.createCustomToken(owner.uid);
        return NextResponse.json({ ok: true, accountSwitched: true, token });
      }
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }

    await adminAuth.updateUser(verifiedUser.uid, { phoneNumber: phone });
    await getDatabase(app).ref(`users/${verifiedUser.uid}`).update({
      mobile: phone,
      mobileVerifiedAt: Date.now(),
    });
    return NextResponse.json({ ok: true, accountSwitched: false });
  } catch (error) {
    console.error('[OTP] phone link route failed', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
