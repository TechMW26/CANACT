# Canact

A **mobile-first, fully responsive** social-location web app — Next.js 14 + Tailwind + Firebase Realtime Database — designed to deploy to **Vercel** as a single web app and work great on phones, tablets, and desktops.

> Theme: candy-white (`#FFF8F8`) surface with **blood-red** (`#C8102E`) accents and black text.

## Features

| Area | Where |
|---|---|
| Sign up / Login (email or mobile) / Forgot password | `src/app/(login|register|forgot)/` |
| Profile (rating, likes/dislikes, attributes, cards, badges, tags) | `src/components/ProfileBody.tsx`, `src/app/(app)/profile/*` |
| Like / Dislike + 6-attribute cooldown (3 positive, 3 negative) | `src/lib/services/votes.ts` |
| 7 cards (give & take back) | `src/lib/services/votes.ts`, ProfileBody |
| What's Happening: photos + comments + reactions + 24h auto-expire | `src/app/(app)/post/*`, `src/lib/services/wha.ts` |
| Polls / Ask / Suggest (open-ended + options) | `src/app/(app)/poll/*`, `src/lib/services/poll.ts` |
| Rate Me (selfie session 1–24 h) | `src/app/(app)/rateme/*`, `src/lib/services/rateme.ts` |
| Help (Red / Orange / Yellow with vicinity, audience, channel, helper accept, requester close yes/no/tried) | `src/app/(app)/help/*`, `src/lib/services/help.ts` |
| Favourites + follow request + accept/reject + block | `src/app/(app)/favourites`, `src/lib/services/favourites.ts` |
| Underground mode (4h timer + extend + growing rating penalty per same-day re-entry) | `src/app/(app)/underground`, `src/lib/services/underground.ts` |
| Leaderboard (Favourites / City / Country / Worldwide) | `src/app/(app)/leaderboard`, `src/lib/services/leaderboard.ts` |
| Search (name / city / country / mobile / email) | `src/app/(app)/search` |
| Notifications | `src/app/(app)/notifications`, `src/lib/services/notifications.ts` |
| Settings (notification sound, sign out, delete profile) | `src/app/(app)/settings` |
| Combined feed with kind filter + vicinity radius | `src/app/(app)/feed` |

### Mobile-first responsive layout

- **Phones**: bottom 5-tab nav (Feed · Help · ➕ · Top · Me), top app bar with Search + Notifications + avatar.
- **Tablets / Desktops**: a **left sidebar** appears with all destinations and a primary "+ Create" button; content centred at `md:max-w-screen-lg`.
- All pages target one column on phones, expand to multi-column where it makes sense.

### What's intentionally deferred

These need vendor accounts/SDKs that aren't free to provision in code:

- Google sign-in (Firebase Auth provider — UI hook is straightforward).
- SMS-OTP for password reset (use Twilio / MSG91; Firebase password reset link is wired today).
- Facial-biometrics, KYC, profession leaderboard.
- In-app voice/video calling (Agora / Twilio Video).
- Cloud Storage for media — currently photos are stored as base64 data URLs in the RTDB. Swap to Firebase Storage for production.
- Map clustering (use Mapbox / Google Maps when ready).
- Push notifications via Web Push (the in-app notification feed is live).

## Setup

1. **Install**
   ```bash
   npm install
   ```
2. **Firebase web credentials** — copy `.env.example` to `.env.local` and fill it in. The DB URL is pre-pinned to:
   ```
   https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app
   ```
3. **Enable Email/Password auth** in Firebase Console → Authentication → Sign-in method.
4. **Set RTDB rules** (permissive starter — tighten later):
   ```json
   {
     "rules": {
       "users":           { ".read": "auth != null", "$uid": { ".write": "auth != null && auth.uid === $uid" } },
       "wha":             { ".read": "auth != null", ".write": "auth != null", ".indexOn": ["createdAt"] },
       "polls":           { ".read": "auth != null", ".write": "auth != null", ".indexOn": ["createdAt"] },
       "ratemeSessions":  { ".read": "auth != null", ".write": "auth != null", ".indexOn": ["endsAt"] },
       "help":            { ".read": "auth != null", ".write": "auth != null", ".indexOn": ["createdAt"] },
       "votes":           { ".read": "auth != null", ".write": "auth != null" },
       "favourites":      { ".read": "auth != null", ".write": "auth != null" },
       "followRequests":  { ".read": "auth != null", ".write": "auth != null" },
       "blocks":          { ".read": "auth != null", ".write": "auth != null" },
       "messages":        { ".read": "auth != null", ".write": "auth != null" },
       "notifications":   { ".read": "auth != null", ".write": "auth != null" },
       "lookups":         { ".read": "auth != null", ".write": "auth != null" },
       "userPosts":       { ".read": "auth != null", ".write": "auth != null" },
       "userPolls":       { ".read": "auth != null", ".write": "auth != null" },
       "userHelps":       { ".read": "auth != null", ".write": "auth != null" },
       "whaComments":     { ".read": "auth != null", ".write": "auth != null" },
       "pollComments":    { ".read": "auth != null", ".write": "auth != null" },
       "pollReacts":      { ".read": "auth != null", ".write": "auth != null" },
       "reports":         { ".read": "auth != null", ".write": "auth != null" }
     }
   }
   ```

## Run locally

```bash
npm run dev          # http://localhost:3000
```

## Build & deploy on Vercel

1. Push this repo to GitHub.
2. New Project on Vercel → import → it auto-detects **Next.js**.
3. Add env vars (the same `NEXT_PUBLIC_FIREBASE_*` keys).
4. Click Deploy. No special config required.

## Project layout

```
src/
  app/
    layout.tsx, page.tsx, globals.css
    login/, register/, forgot/
    (app)/                ← authed group (uses AppShell)
      layout.tsx
      feed/
      help/, help/create/, help/[id]/
      create/
      post/create/, post/[id]/
      poll/create/, poll/[id]/
      rateme/start/
      profile/, profile/[uid]/
      favourites/, leaderboard/, search/, notifications/
      underground/, settings/, edit-profile/
  components/             AppShell, Button, Input, Card, Avatar, Modal, Toaster, ProfileBody
  lib/
    firebase.ts, auth.tsx, types.ts, utils.ts, useGeo.ts
    services/             wha, poll, rateme, help, votes, favourites, leaderboard, notifications, underground
```

## Spec ↔ code map (notable)

- **6-hour attribute cooldown** — `lib/services/votes.ts → setAttribute`.
- **Auto-vote on first attribute** (positive ⇒ like, negative ⇒ dislike) — same function.
- **Cards = one per pair**, give/take back — `votes/{toUid}/{fromUid}/cards/{card}` flag.
- **WHA expiry 24h** — filtered in `listenWhaFeed`.
- **Rate Me** windows 1–24 h, default 4 h — `rateme/start/page.tsx`.
- **Help vicinities** 15m, 50m, 250m, 1km, 5km, 20km — `help/create/page.tsx`.
- **Red Help requires rating ≥ 3.5** — guarded in `services/help.ts → createHelp`.
- **Underground** rating penalty `min(0.4, 0.05 × sameDayCount)` — `services/underground.ts`.
- **Leaderboard** scopes Favourites / City / Country / Worldwide — `services/leaderboard.ts`.
