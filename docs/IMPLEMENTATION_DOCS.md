# CANACT — Recent Implementation Documentation

## 1. Selfie Verification System (2026-07-17)

### Overview
Replaced the simple camera selfie capture on registration with a browser-based face landmark and liveness check. Users must pass a **4-step liveness check** before their selfie is accepted. This deters basic fake-profile and static photo attempts; it is not biometric identity matching or a substitute for server-side identity verification.

### Architecture

```
User taps "Verify identity"
        │
        ▼
┌─────────────────────────────────┐
│     SelfieVerifier Component     │
│  (src/components/SelfieVerifier) │
│                                  │
│  1. Load face-api.js models      │
│     ├─ TinyFaceDetector (192KB)  │  ← /public/models/
│     └─ FaceLandmark68Tiny (76KB) │
│                                  │
│  2. Start camera (front-facing)  │
│     └─ 640×800, user-facing      │
│                                  │
│  3. Async detection loop (RAF)   │
│     ├─ Canvas overlay with oval  │
│     └─ Real-time face detection  │
│                                  │
│  4. Liveness state machine       │
│     ├─ POSITION → face centered  │
│     ├─ VISIBILITY → stable face  │
│     ├─ BLINK   → EAR < 0.24 ×2   │
│     └─ HOLD    → capture JPEG     │
│                                  │
│  5. Return data URL to caller    │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Onboard Page (onboard/page)   │
│                                  │
│  selfieData → uploadMedia()     │
│  → Vercel Blob CDN URL          │
│  → updateMyProfile({ photoURL })│
│  → profileComplete = true       │
└─────────────────────────────────┘
```

### Liveness Detection Details

| Step | Check | Technical Implementation |
|------|-------|--------------------------|
| **Position** | Face centered & large enough | `faceRatio = (box.width × box.height) / (video.width × video.height) > 0.08`, confidence ≥ 0.7 |
| **Visibility** | Eyes and face remain unobstructed | Six consecutive centered frames with a valid eye-aspect reading. The landmark model does not claim to classify eyewear. |
| **Blink** | 2 natural blinks | Eye Aspect Ratio (EAR): `(|p2-p6| + |p3-p5|) / (2×|p1-p4|) < 0.24` threshold, 400ms cooldown between blinks |
| **Hold** | Stable frame capture | Eight consecutive well-positioned frames, then captures a mirrored JPEG at q=0.92 |

**Eye Aspect Ratio (EAR)** uses 6 landmark points per eye:
- Points 1,4: horizontal corners
- Points 2,6, 3,5: vertical lids
- EAR drops below 0.24 when eye closes (blink), returns above 0.30 when open

### Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/components/SelfieVerifier.tsx` | **New** | Full liveness verifier with face-api.js |
| `src/app/onboard/page.tsx` | Modified | Replaced `CameraCapture` with `SelfieVerifier`, updated UI text |
| `scripts/download-face-models.sh` | **New** | Downloads model weights from GitHub |
| `public/models/` | **New** | 4 model files (~270KB) |
| `package.json` | Modified | Added `face-api.js` dependency |

### UI Text Changes (onboard selfie screen)

| Before | After |
|--------|-------|
| "Verify with a selfie" | "Verify it's really you" |
| "This helps keep Canact safe, genuine, and free from fake profiles." | "Take a live photo to confirm your identity. This keeps Canact safe from fake profiles." |
| "Tap to open camera" | "Tap to verify" |
| "Private and secure" / "Only used for verification" / "Takes less than a minute" | "Live camera capture" / "Saved as your profile photo" / "Blink & liveness check" |
| "Take selfie" (footer) | "Verify identity" (footer) |

---

## 2. Media Pipeline Optimization (2026-07-16)

### Image Resize Before Upload
**File:** `src/lib/uploadMedia.ts`

Instagram-style on-device preprocessing: images are downscaled to max 1080px and transcoded to WebP at q=0.82 before upload. This cuts CDN bandwidth ~60–80% for 12MP camera shots shown at 400px feed tiles.

```typescript
// New: PrepareOptions type
type PrepareOptions = {
  maxWidth?: number;   // default 1080
  maxHeight?: number;  // default 1080
  quality?: number;    // default 0.82
};

// New functions added:
resizeImageBlob(blob, maxWidth, maxHeight, quality)  // canvas-based downscale
generateLqip(blob)                                    // 20px blur placeholder
```

### LQIP Blur-Up (Progressive Image Loading)
**Files:** `src/lib/uploadMedia.ts`, `src/components/LqipObserver.tsx`, `src/app/globals.css`

Every uploaded image generates a tiny 20px base64 LQIP. Feed tiles render this instantly as a blurred CSS `background-image`, then fade to the full-resolution image via opacity transition.

```
Data flow:
  uploadMedia() → RTDB record → feed tile <img>
     │                │                │
     └─ lqip ─────────┴─ stored ───────┴─ background-image + lqip-img class

  LqipObserver (global) catches img load events → adds lqip-loaded class
  CSS: .lqip-img { opacity: 0 } → .lqip-loaded { opacity: 1 } (450ms ease)
```

**Types updated** with `lqip`/`mediaLqips` fields:
- `WhaPost.mediaLqips?: string[]`
- `Poll.lqip?: string`
- `RateMeSession.lqip?: string`
- `StoryItem.lqip?: string`
- `ReelItem.lqip?: string`

### Parallel Uploads
**File:** `src/app/(app)/post/create/page.tsx`

Changed from sequential `for...of` to `Promise.all(shots.map(...))`. 10 photos now upload concurrently instead of one-at-a-time.

### Rate-Me Fix (CRITICAL)
**File:** `src/app/(app)/rateme/start/page.tsx`

Was storing raw `data:video/...` or `data:image/...` URLs directly in Firebase RTDB — causing multi-MB base64 strings in every feed read. Now uploads to Vercel Blob via `uploadMedia()` before storing.

### VideoPreview Loading/Error States
**File:** `src/components/VideoPreview.tsx`

Added: loading skeleton pulse animation, error state with `AlertTriangle` icon + retry button, `canplay`/`error` event listeners, fade-in opacity transition.

### Stories Listener Cap
**File:** `src/lib/services/stories.ts`

Capped the rendered result from `listenActiveStories` at 30 most-recent users and 100 total stories. Because legacy and current records share a nested root, the listener still receives the root snapshot; a timestamp-indexed flat feed is needed before Firebase can enforce the limit at query time.

---

## 3. Poll Creation Fix (2026-07-16)

**File:** `src/app/(app)/poll/create/page.tsx`

Fixed: polls without photos failed to post because `photoURL` was `undefined`, which Firebase RTDB omits. If security rules validated `photoURL` as a string, the write was rejected. Changed fallback from `undefined` to `''` (empty string).

---

## 4. Profile: Canact Score + Friend/Favourite Flow + Gold Ring (2026-07-16)

**File:** `src/components/ProfileBody.tsx`

### Canact Score Badge
Shown on ALL profiles (self + others) below the avatar: a black pill with colored dot + numeric score + tier label (`TRUST`/`GOOD`/`FAIR`/`LOW`). Uses `calculateCanactScore()` from `src/lib/canactScore.ts`.

### Friend/Favourite Button Flow

| Status | Button Label | Button Color | Click Action |
|--------|-------------|-------------|--------------|
| `none` | "Add Friend" | brand green | Sends friend request + auto-likes profile |
| `requested` | "Requested" | brand green | Cancels friend request |
| `incoming` | "Accept" | brand green | Accepts friend request |
| `friends` | "Add to Favourites" | **gold** `#E8B830` | Sends follow/favourite request |
| `isFavourite` | "★ Favourited" | **gold** `#E8B830` | (no action) |

### Golden Favourite Ring
When the viewer has added the profile user to their favourites, the avatar border changes from white (`#faf8f2`) to gold (`#E8B830`) with a subtle golden glow shadow. Detected via `listenFavourites()` real-time listener.

---

## 5. Admin Dashboard: Heatzones + Backup Removal (2026-07-16)

### Removed: File Backup System
- **Deleted:** `src/app/api/admin/backups/` (entire directory — 2 API routes)
- **Removed from admin page:** `BackupItem`, `BackupUser`, `BackupResponse` types, `backups` view, `analytics` view, `BackupsPage`, `AnalyticsPage`, `SelectedUserPanel`, `BackupFileTable`, `UserBackupCard`, `buildAnalytics`, `countBy`, `percentOf`

### Added: Heatzones Analytics
- **`src/lib/services/heatzones.ts`** — Client-side tracking: `recordPageView()` and `recordFeatureClick()` write to RTDB `heatzones/pageViews/` and `heatzones/featureClicks/`. Maps 20+ app routes and per-page feature IDs.
- **`src/app/api/admin/heatzones/route.ts`** — Admin API: aggregates page views into leaderboard, jump heatmaps (from-page → to-page), and per-page feature leaderboards.
- **`src/components/PageViewTracker.tsx`** — Silent component in root layout; tracks every route change with previous→current page and user UID.
- **Admin page sections:**
  - **Page Leaderboard** — ranked list of most-visited pages with % bars
  - **Jump Heatmap** — for each page, shows which pages users arrived from
  - **Feature Leaderboard** — dark-themed panel showing most-clicked features per page

### RTDB Data Model for Heatzones
```
heatzones/
  pageViews/
    Feed_2026-07-17/
      {pushKey}: { pageId, fromPage, uid, pathname, timestamp }
  featureClicks/
    Feed_2026-07-17/
      {pushKey}: { pageId, featureId, uid, timestamp }
```

---

## 6. Build Fix (2026-07-17)

**File:** `src/lib/services/heatzones.ts`

Fixed import path: `'./firebase'` → `'../firebase'` (file is in `src/lib/services/`, firebase is in `src/lib/`).

---

## Summary of All Changed Files

| File | Date | Change |
|------|------|--------|
| `src/lib/uploadMedia.ts` | Jul 16 | resizeImageBlob, generateLqip, PrepareOptions |
| `src/components/LqipObserver.tsx` | Jul 16 | New — global LQIP load handler |
| `src/app/globals.css` | Jul 16 | .lqip-img / .lqip-loaded CSS |
| `src/lib/types.ts` | Jul 16 | lqip/mediaLqips fields on 5 interfaces |
| `src/lib/services/poll.ts` | Jul 16 | lqip field in createPoll |
| `src/lib/services/rateme.ts` | Jul 16 | lqip field in startRateMe |
| `src/lib/services/stories.ts` | Jul 16 | Cap listenActiveStories at 30 users / 100 stories |
| `src/app/(app)/post/create/page.tsx` | Jul 16 | Parallel uploads, LQIP pass-through |
| `src/app/(app)/poll/create/page.tsx` | Jul 16 | photoURL '' fallback, resize opts, LQIP |
| `src/app/(app)/rateme/start/page.tsx` | Jul 16 | uploadMedia before RTDB store, LQIP |
| `src/app/(app)/reel/create/page.tsx` | Jul 16 | LQIP pass-through |
| `src/app/(app)/story/create/page.tsx` | Jul 16 | LQIP pass-through, resize opts |
| `src/app/(app)/feed/page.tsx` | Jul 16 | LQIP on WhaTile, PollCard, RateMeCard |
| `src/components/MediaSlider.tsx` | Jul 16 | lqips prop, LQIP on all <img> |
| `src/components/PostDetailSheet.tsx` | Jul 16 | LQIP on post/poll/rateme details |
| `src/components/VideoPreview.tsx` | Jul 16 | Loading skeleton, error state, retry |
| `src/components/ProfileBody.tsx` | Jul 16 | Canact score badge, friend/favourite flow, gold ring |
| `src/app/layout.tsx` | Jul 16–17 | LqipObserver, PageViewTracker |
| `src/app/admin/page.tsx` | Jul 16 | Heatzones, backup removal |
| `src/app/api/admin/heatzones/route.ts` | Jul 16 | New — heatzones aggregation API |
| `src/lib/services/heatzones.ts` | Jul 16–17 | New — page view & feature tracking |
| `src/components/PageViewTracker.tsx` | Jul 16 | New — route change tracker |
| `src/components/SelfieVerifier.tsx` | Jul 17 | New — liveness verification |
| `src/app/onboard/page.tsx` | Jul 17 | SelfieVerifier integration |
| `scripts/download-face-models.sh` | Jul 17 | New — model download script |
| `public/models/` | Jul 17 | New — face-api.js model weights |
