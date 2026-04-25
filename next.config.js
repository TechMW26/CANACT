/** @type {import('next').NextConfig} */
// The real Firebase Auth handler host. We always proxy to this regardless of
// what NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is set to (so users can set authDomain
// to their own app domain and still have the handler work).
const FIREBASE_AUTH_HOST = 'canact-94ad6.firebaseapp.com';

const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // Same-origin Firebase Auth: proxy /__/auth/* and /__/firebase/* to the real
  // Firebase Hosting handler. With NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN set to your
  // app's own domain (e.g. canact.vercel.app), Google sign-in completes on the
  // SAME origin as the app — no third-party cookies / iframe storage needed.
  async rewrites() {
    return [
      { source: '/__/auth/:path*', destination: `https://${FIREBASE_AUTH_HOST}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `https://${FIREBASE_AUTH_HOST}/__/firebase/:path*` },
    ];
  },
};
module.exports = nextConfig;
