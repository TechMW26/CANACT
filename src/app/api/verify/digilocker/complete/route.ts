import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'DigiLocker verification has been replaced by manual review.' }, { status: 410 });
}
