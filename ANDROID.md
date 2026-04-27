# Canact Android (Capacitor)

The Android app is a thin Capacitor wrapper around the production web build at
`https://canact.vercel.app`. It ships a branded splash screen, a custom offline
fallback page, and adaptive icons generated from `Canact.png`.

## One-time setup

1. Install Android Studio + JDK 17.
2. Open Android Studio → **Open** → select the `android/` folder of this repo.
3. Let Gradle sync complete (first sync downloads the Android SDK + Capacitor
   bridge artefacts).

## Build & run

```bash
# 1. Sync any web/config changes into the native project
npm run android:sync

# 2. Open Android Studio with the project pre-loaded
npm run android:open

# 3. Click Run ▶ in Android Studio (or build the APK from Build → Build Bundle(s) / APK)
```

To regenerate launcher icons / splash from `assets/icon-only.png` and
`assets/splash.png`:

```bash
npm run android:assets
npm run android:sync
```

## What the app does

- Loads `https://canact.vercel.app` inside an Android WebView.
- Shows a full-screen branded splash (drawable: `@drawable/splash`) for ~1.8 s
  on cold start.
- Falls back to bundled `android-www/offline.html` when the network is down
  (configured via `server.errorPath` in `capacitor.config.ts`).
- Status bar uses the brand red (`#C8102E`); window background uses candy
  (`#FFF8F8`) so transitions blend with the web app.

## App identity

| key       | value             |
| --------- | ----------------- |
| App ID    | `com.canact.app`  |
| App name  | `Canact`          |
| Web URL   | `https://canact.vercel.app` |
| Icon src  | `Canact.png` (root) |
