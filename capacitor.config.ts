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
    backgroundColor: '#FFFFFF',
  },
  ios: {
    backgroundColor: '#FFFFFF',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#005445',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      androidSplashResourceName: 'splash',
    },
    FirebaseAuthentication: {
      // Phone auth must be loaded natively so Android/iOS can use Firebase's
      // device verification instead of browser reCAPTCHA inside the WebView.
      skipNativeAuth: false,
      providers: ['google.com', 'phone'],
    },
  },
};

export default config;
