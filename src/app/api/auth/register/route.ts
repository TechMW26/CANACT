import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/server/password';
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/server/jwt';
import { rtdbGet, rtdbPut, encodeKey } from '@/lib/server/rtdb';

export const runtime = 'nodejs';

function newUid() {
  return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstName, middleName, lastName, email, mobile, password, city, country } = body ?? {};
    if (!firstName || !lastName || !password || (!email && !mobile)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const phone = String(mobile ?? '').replace(/[^0-9]/g, '');
    if (phone) {
      const exists = await rtdbGet(`lookups/byMobile/${phone}`);
      if (exists) return NextResponse.json({ error: 'Mobile already registered' }, { status: 409 });
    }
    if (email) {
      const exists = await rtdbGet(`lookups/byEmail/${encodeKey(email)}`);
      if (exists) return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    const uid = newUid();
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const passwordHash = hashPassword(password);
    const profile = {
      uid, fullName, firstName, middleName: middleName ?? null, lastName,
      email: email ?? null, mobile: phone || null, city: city ?? null, country: country ?? null,
      rating: 0, ratingCount: 0, likesCount: 0, dislikesCount: 0,
      attrs: { behaviour: 0, action: 0, reliable: 0, rude: 0, inactive: 0, unreliable: 0 },
      cardsReceived: { understanding: 0, humour: 0, goodVibes: 0, confidence: 0, intelligence: 0, creativity: 0, daring: 0 },
      badges: [], tags: ['New User', 'Unverified Profile'],
      notificationSound: true, passwordHash, createdAt: Date.now(),
    };
    await rtdbPut(`users/${uid}`, profile);
    if (phone) await rtdbPut(`lookups/byMobile/${phone}`, { uid, email: email ?? null });
    if (email) await rtdbPut(`lookups/byEmail/${encodeKey(email)}`, { uid, mobile: phone || null });

    const token = await signSession(uid);
    const res = NextResponse.json({ uid });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
