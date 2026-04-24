import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/server/password';
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/server/jwt';
import { rtdbGet, encodeKey } from '@/lib/server/rtdb';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { idOrEmail, password } = await req.json();
    if (!idOrEmail || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }
    const id = String(idOrEmail).trim();
    let uid: string | null = null;
    if (id.includes('@')) {
      const v = await rtdbGet<{ uid: string }>(`lookups/byEmail/${encodeKey(id)}`);
      uid = v?.uid ?? null;
    } else {
      const v = await rtdbGet<{ uid: string }>(`lookups/byMobile/${id.replace(/[^0-9]/g, '')}`);
      uid = v?.uid ?? null;
    }
    if (!uid) return NextResponse.json({ error: 'No account found' }, { status: 404 });
    const profile = await rtdbGet<any>(`users/${uid}`);
    if (!profile) return NextResponse.json({ error: 'Profile missing' }, { status: 404 });
    if (!verifyPassword(password, profile.passwordHash)) {
      return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
    }

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
