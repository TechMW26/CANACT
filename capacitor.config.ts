import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the production web app inside an Android WebView, pointing
 * at canact.vercel.app. When the network drops, the WebView falls back to the
 * bundled `offline.html` (configured via `server.errorPath`).
 */
const config: CapacitorConfig = {
  appId: 'com.canact.app',
  appName: 'Canact',
  webDir: 'android-www',
  server: {
    url: 'https://canact.vercel.app',
    androidScheme: 'https',
    cleartext: false,
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#FFF8F8',
    webContentsDebuggingEnabled: false,
    // Force GPU rendering for backdrop-blur / glass-morphism effects.
    initialScale: 1,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#FFF8F8',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      androidSplashResourceName: 'splash',
    },
    FirebaseAuthentication: {
      // Native Google Sign-In is the only provider we use natively. Email-link
      // and other flows continue to run through the web SDK in the WebView.
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
