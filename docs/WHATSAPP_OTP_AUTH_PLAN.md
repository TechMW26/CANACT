# CANACT — Phone OTP Authentication Migration Plan

## Overview

Replace email + password authentication with **phone-number OTP**. Both sign-up and sign-in use only a phone number verified via a 6-digit code. Two OTP providers with automatic fallback:

| Priority | Provider | Channel | Cost | Coverage |
|----------|----------|---------|------|----------|
| **Primary** | Firebase Phone Auth | SMS | ~$0.01/verify (Blaze plan) | Global, 220+ countries |
| **Fallback** | Vobiz WhatsApp API | WhatsApp | ~₹0.30/message | India-primary, WhatsApp users |

> **Decision**: Firebase Phone Auth handles SMS OTP globally — it's already built into the Firebase SDK you use. If it fails (network timeout, quota exceeded, phone not supported in region), Vobiz WhatsApp OTP kicks in as fallback. If both fail, user gets a clear error with retry.

---

## 1. Firebase Phone Auth Pipeline (PRIMARY)

### 1.1 Why Firebase First

- **Zero new dependencies** — already using Firebase SDK (`firebase@11.10.0`), `firebase-admin@13.10.0`
- **Zero new server code** — `signInWithPhoneNumber()` is entirely client-side
- **Global SMS delivery** — Google's infrastructure, 220+ countries
- **Native Android support** — Capacitor plugin handles SafetyNet/Play Integrity (no reCAPTCHA)
- **Automatic new/returning user detection** — Firebase Auth knows if phone is new

### 1.2 How It Works

```
┌──────────────────────────────────────────────────────────┐
│                    FIREBASE PHONE AUTH                    │
│                                                          │
│  Client (web):                                           │
│   1. Setup invisible reCAPTCHA verifier                  │
│   2. signInWithPhoneNumber(auth, phone, verifier)        │
│      → Firebase sends SMS with 6-digit code              │
│   3. User enters code                                    │
│   4. confirmationResult.confirm(code)                    │
│      → Firebase verifies + signs in                      │
│                                                          │
│  Client (Android Capacitor):                             │
│   • No reCAPTCHA needed                                  │
│   • Uses SafetyNet / Play Integrity API automatically    │
│                                                          │
│  onAuthStateChanged fires → profile loaded from RTDB     │
│  routeAfterSignIn() → /onboard (new) or / (returning)    │
└──────────────────────────────────────────────────────────┘
```

### 1.3 Client-Side Code

```typescript
// src/lib/services/otp.ts (PRIMARY: Firebase SMS)

import { getAuth, signInWithPhoneNumber, RecaptchaVerifier, ConfirmationResult } from 'firebase/auth';

let fbConfirmation: ConfirmationResult | null = null;

/** Send OTP via Firebase SMS. Must be called from a user gesture. */
export async function sendFirebaseOTP(
  phone: string,
  recaptchaContainerId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = getAuth();
    const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
      size: 'invisible',
      callback: () => { /* reCAPTCHA solved */ },
    });
    fbConfirmation = await signInWithPhoneNumber(auth, phone, verifier);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to send OTP' };
  }
}

/** Verify OTP via Firebase. Returns user on success. */
export async function verifyFirebaseOTP(code: string): Promise<{ ok: boolean; error?: string }> {
  if (!fbConfirmation) return { ok: false, error: 'No OTP was sent' };
  try {
    await fbConfirmation.confirm(code);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Invalid code' };
  }
}
```

### 1.4 Required Setup (One-Time)

1. **Firebase Console → Authentication → Sign-in method → Phone → Enable**
2. **Blaze Plan** (pay-as-you-go): Phone Auth requires Blaze. Spark (free) has very limited SMS quota.
3. **Firebase Console → Project settings → App check**: Optional for production; skip for now.

### 1.5 reCAPTCHA in Welcome Page

Firebase web Phone Auth requires a reCAPTCHA verifier. Add a hidden div:

```tsx
<div id="recaptcha-container" style={{ position: 'fixed', bottom: 0, opacity: 0, pointerEvents: 'none' }} />
```

For Android Capacitor (`@capacitor-firebase/authentication`), reCAPTCHA is bypassed — the phone number is verified via SafetyNet/Play Integrity natively.

---

## 2. Vobiz WhatsApp OTP Pipeline (FALLBACK)

### 2.1 When Vobiz Kicks In

Firebase Phone Auth fails → Vobiz is tried automatically:

| Firebase Error Code | Meaning | Vobiz Action |
|---------------------|---------|--------------|
| `auth/too-many-requests` | SMS quota exhausted | Try Vobiz |
| `auth/network-request-failed` | Network timeout | Try Vobiz |
| `auth/invalid-phone-number` | Format not supported | Try Vobiz (with same phone) |
| `auth/operation-not-allowed` | Phone Auth not enabled | Try Vobiz |
| `auth/captcha-check-failed` | reCAPTCHA blocked | Try Vobiz |

### 2.2 Vobiz API (Expected)

Vobiz (`vobiz.in`) is an Indian WhatsApp BSP. Based on industry-standard WhatsApp BSP patterns:

**Send OTP:**
```
POST https://api.vobiz.in/v1/whatsapp/otp/send
Authorization: Bearer <VOBZ_API_KEY>
Content-Type: application/json
{ "phone": "+919XXXXXXXXX", "template_name": "otp_verification", "otp_length": 6, "expiry_minutes": 5 }
→ { "success": true, "message_id": "wamid.xxxxx" }
```

**Verify OTP:**
```
POST https://api.vobiz.in/v1/whatsapp/otp/verify
Authorization: Bearer <VOBZ_API_KEY>
Content-Type: application/json
{ "phone": "+919XXXXXXXXX", "otp": "123456" }
→ { "success": true, "verified": true }
```

### 2.3 Server-Side Routes (Vobiz Only)

Unlike Firebase (client-side), Vobiz needs server routes to protect the API key:

**`POST /api/auth/send-otp`** — Vobiz fallback send:
```typescript
// src/app/api/auth/send-otp/route.ts
export async function POST(req: Request) {
  const { phone } = await req.json();
  // Rate limit: 5 sends per phone per hour
  const res = await fetch(`${process.env.VOBZ_API_URL}/v1/whatsapp/otp/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.VOBZ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, template_name: 'otp_verification', otp_length: 6, expiry_minutes: 5 }),
  });
  const data = await res.json();
  return NextResponse.json({ ok: !!data.success });
}
```

**`POST /api/auth/verify-otp`** — Vobiz verify + Firebase custom token:
```typescript
// src/app/api/auth/verify-otp/route.ts
export async function POST(req: Request) {
  const { phone, otp } = await req.json();
  // Verify with Vobiz
  const res = await fetch(`${process.env.VOBZ_API_URL}/v1/whatsapp/otp/verify`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.VOBZ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp }),
  });
  const data = await res.json();
  if (!data.success) return NextResponse.json({ ok: false }, { status: 400 });

  // Lookup or create Firebase user by phone number
  const adminAuth = getAuth(getFirebaseAdminApp());
  let uid: string;
  try {
    uid = (await adminAuth.getUserByPhoneNumber(phone)).uid;
  } catch {
    uid = (await adminAuth.createUser({ phoneNumber: phone })).uid;
  }

  // Issue Firebase custom token for client sign-in
  const token = await adminAuth.createCustomToken(uid);
  return NextResponse.json({ ok: true, token, uid });
}
```

### 2.4 Vobiz Env Vars

```env
VOBZ_API_KEY="vobiz_live_xxxxxxxxxxxxx"
VOBZ_API_URL="https://api.vobiz.in/v1"
```

### 2.5 Vobiz Action Items

1. Sign up at [vobiz.in](https://vobiz.in) → WhatsApp Business API
2. Register WhatsApp Business number (the sender number)
3. Get API key from dashboard
4. Submit OTP template for WhatsApp approval: `"Your Canact verification code is {{1}}. It expires in 5 minutes."`
5. Confirm exact endpoints with Vobiz support

---

## 3. Unified Smart OTP Service (Both Providers)

```typescript
// src/lib/services/otp.ts — Complete smart OTP with Firebase→Vobiz fallback

import { getAuth, signInWithPhoneNumber, RecaptchaVerifier, ConfirmationResult } from 'firebase/auth';

type OTPChannel = 'firebase-sms' | 'vobiz-whatsapp';

let fbConfirmation: ConfirmationResult | null = null;
let currentChannel: OTPChannel | null = null;
let pendingPhone: string = '';

/**
 * Smart send: Firebase SMS first, Vobiz WhatsApp fallback.
 * Returns which channel was used so UI can show the right message.
 */
export async function sendOTP(
  phone: string,
  recaptchaId: string
): Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> {
  pendingPhone = phone;

  // ── TRY 1: FIREBASE SMS ──
  try {
    const auth = getAuth();
    const verifier = new RecaptchaVerifier(auth, recaptchaId, { size: 'invisible' });
    fbConfirmation = await signInWithPhoneNumber(auth, phone, verifier);
    currentChannel = 'firebase-sms';
    return { ok: true, channel: 'firebase-sms' };
  } catch (fbErr: any) {
    console.warn('[OTP] Firebase SMS failed, trying Vobiz:', fbErr?.code);
  }

  // ── TRY 2: VOBZ WHATSAPP ──
  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Vobiz failed');
    currentChannel = 'vobiz-whatsapp';
    return { ok: true, channel: 'vobiz-whatsapp' };
  } catch {
    return { ok: false, error: 'Unable to send code. Please try again later.' };
  }
}

/**
 * Smart verify: Firebase confirm() if SMS, Vobiz API if WhatsApp.
 */
export async function verifyOTP(code: string): Promise<{ ok: boolean; error?: string }> {
  if (currentChannel === 'firebase-sms') {
    if (!fbConfirmation) return { ok: false, error: 'No code was sent' };
    try { await fbConfirmation.confirm(code); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err?.message || 'Wrong code' }; }
  }

  if (currentChannel === 'vobiz-whatsapp') {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, otp: code }),
      });
      const data = await res.json();
      if (!data.ok || !data.token) throw new Error('Wrong code');
      // Sign into Firebase with the custom token
      await getAuth().signInWithCustomToken(data.token);
      return { ok: true };
    } catch (err: any) { return { ok: false, error: err?.message || 'Wrong code' }; }
  }

  return { ok: false, error: 'No code was sent' };
}

/** Which channel delivered the OTP? For UI display. */
export function getOTPChannel(): OTPChannel | null { return currentChannel; }

/** Reset state (e.g. on back navigation). */
export function resetOTP() {
  fbConfirmation = null;
  currentChannel = null;
  pendingPhone = '';
}
```

---

## 4. Auth Flows (Sign-Up & Sign-In are Identical)

Both use the same phone→OTP→verify path. Firebase determines if the phone is new or returning.

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER ENTERS PHONE                         │
│                   PhoneInput (country + number)                  │
│                     "Get OTP"                     │
│                              │                                   │
│                              ▼                                   │
│                   ┌─────────────────────┐                       │
│                   │ Try FIREBASE SMS     │                       │
│                   └────────┬────────────┘                       │
│                            │                                     │
│              ┌─────────────┴─────────────┐                      │
│              ▼                           ▼                       │
│         SUCCESS                      FAILURE                     │
│     (SMS sent)              (quota/network/timeout)             │
│              │                           │                       │
│              │                           ▼                       │
│              │              ┌─────────────────────┐             │
│              │              │ Try VOBZ WhatsApp    │             │
│              │              └────────┬────────────┘             │
│              │                       │                            │
│              │           ┌───────────┴───────────┐              │
│              │           ▼                       ▼               │
│              │      SUCCESS                  FAILURE             │
│              │   (WhatsApp sent)        (both providers down)    │
│              │           │                       │               │
│              │           │                       ▼               │
│              │           │           ┌──────────────────┐       │
│              │           │           │ "Unable to send   │       │
│              │           │           │  code. Try again  │       │
│              │           │           │  later." [Retry]  │       │
│              │           │           └──────────────────┘       │
│              ▼           ▼                                       │
│         ┌─────────────────────────────────────────┐             │
│         │             OTP INPUT SCREEN              │             │
│         │       6-digit code (auto-advance)         │             │
│         │       "Resend" (30s cooldown)             │             │
│         │                                           │             │
│         │  "Code sent via SMS to +91 9876543210"    │             │
│         │        — OR —                             │             │
│         │  "Code sent via WhatsApp to +91 98765…"   │             │
│         └────────────────────┬────────────────────┘             │
│                              │                                   │
│                              ▼                                   │
│              ┌──────────────────────────┐                       │
│              │     VERIFY OTP CODE       │                       │
│              │  (Firebase or Vobiz API)  │                       │
│              └────────────┬─────────────┘                       │
│                           │                                      │
│                           ▼                                      │
│                   ┌───────────────┐                             │
│                   │ AUTHENTICATED │                             │
│                   └───────┬───────┘                             │
│                           │                                      │
│                           ▼                                      │
│                 routeAfterSignIn()                               │
│                 → /onboard  (new user)                          │
│                 → /onboard  (returning, profile incomplete)     │
│                 → /         (returning, profile complete)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. What Gets Removed

| Component | File |
|-----------|------|
| `signInWithEmail()` | `src/lib/auth.tsx` |
| `signUpWithEmail()` | `src/lib/auth.tsx` |
| `signInWithGoogle()` | `src/lib/auth.tsx` |
| `getGoogleProvider()` | `src/lib/firebase.ts` |
| Email + Password inputs | `src/app/welcome/page.tsx` |
| Login/Register tab switcher | `src/app/welcome/page.tsx` |
| "Forgot password?" link | `src/app/welcome/page.tsx` |
| "Remember me" checkbox | `src/app/welcome/page.tsx` |
| Google sign-in button + SVG | `src/app/welcome/page.tsx` |
| Hardcoded admin credentials | `src/app/welcome/page.tsx` |
| Dev panel | `src/app/welcome/page.tsx` |
| Email field (read-only) | `src/app/onboard/page.tsx` (details screen) |
| `/auth/native` page | `src/app/auth/native/page.tsx` (entire file) |
| Capacitor native Google auth | `src/lib/auth.tsx` |

---

## 6. What Gets Added

| Component | File |
|-----------|------|
| `sendOTP()` / `verifyOTP()` / `resetOTP()` | `src/lib/services/otp.ts` |
| POST `/api/auth/send-otp` | `src/app/api/auth/send-otp/route.ts` |
| POST `/api/auth/verify-otp` | `src/app/api/auth/verify-otp/route.ts` |
| reCAPTCHA container `<div>` | `src/app/welcome/page.tsx` |
| Phone-only welcome UI | `src/app/welcome/page.tsx` (rewritten) |
| OTP input screen (6-digit) | `src/app/welcome/page.tsx` (rewritten) |

---

## 7. Welcome Page UI (New Design)

```
┌─────────────────────────────────────┐
│          [Canact Brand Art]         │
│                                     │
│       "Create your account"         │
│   "Start building genuine connections"│
│                                     │
│   ┌─────────────────────────────┐   │
│   │ 🇮🇳 +91 │ 98765 43210     │   │  ← PhoneInput
│   └─────────────────────────────┘   │
│                                     │
│   ┌─────────────────────────────┐   │
│   │   Get OTP    │   │  ← Green pill button
│   └─────────────────────────────┘   │
│                                     │
│   Already have an account? Log in   │  ← Toggle sign-up/sign-in
│                                     │
│   <div id="recaptcha-container" />  │  ← Hidden reCAPTCHA
└─────────────────────────────────────┘

           │ User taps button → OTP sent
           ▼

┌─────────────────────────────────────┐
│          [Canact Brand Art]         │
│                                     │
│    "Enter verification code"        │
│   "Sent via SMS to +91 9876543210"  │  ← Shows channel
│                                     │
│   ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐        │
│   │1│ │2│ │3│ │4│ │5│ │6│        │  ← 6 inputs, auto-advance
│   └─┘ └─┘ └─┘ └─┘ └─┘ └─┘        │     auto-submit on 6th digit
│                                     │
│   Resend code in 24s                │  ← 30s countdown timer
│                                     │
│   Wrong number? Go back             │
└─────────────────────────────────────┘

           │ Auto-submit → authenticated
           ▼
       → /onboard (new) or / (returning)
```

---

## 8. File Manifest (Complete)

| File | Change |
|------|--------|
| `src/lib/services/otp.ts` | **NEW** |
| `src/app/api/auth/send-otp/route.ts` | **NEW** |
| `src/app/api/auth/verify-otp/route.ts` | **NEW** |
| `src/lib/auth.tsx` | **MODIFIED** |
| `src/app/welcome/page.tsx` | **REWRITTEN** |
| `src/app/onboard/page.tsx` | **MODIFIED** |
| `src/app/auth/native/page.tsx` | **DELETED** |
| `src/lib/firebase.ts` | **MODIFIED** |

---

## 9. Rollout Phases

### Phase 1 — Firebase OTP Only (Do First)
1. Enable Phone Auth in Firebase Console
2. Implement `sendFirebaseOTP` / `verifyFirebaseOTP` in `otp.ts`
3. Rewrite welcome page: phone-only UI + OTP input
4. Remove email/password/Google from auth.tsx + welcome page
5. Test: sign-up → onboard → sign-out → sign-in

### Phase 2 — Vobiz Fallback (After Vobiz Setup)
1. Register with Vobiz, get API key, approve template
2. Implement `/api/auth/send-otp` + `/api/auth/verify-otp` routes
3. Add fallback logic to `sendOTP()` in `otp.ts`
4. Test: force Firebase failure → Vobiz fallback works

### Phase 3 — Polish
1. Rate limiting on API routes (3 attempts/phone/5min)
2. 30s resend countdown timer in UI
3. Test on Android Capacitor (native phone auth, no reCAPTCHA)
