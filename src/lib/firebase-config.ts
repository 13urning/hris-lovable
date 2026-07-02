import type { FirebaseOptions } from "firebase/app";

// Per-environment PUBLIC Firebase web config. These values are NOT secrets — they
// ship in the client bundle by design — but the projectId here MUST match the
// project the server verifies tokens against (FIREBASE_PROJECT_ID), or every login
// breaks. Staging and prod use SEPARATE Firebase projects so auth operations
// (password reset, delete, create) in staging can't touch production accounts.

export const PROD_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: "AIzaSyC4W2GyXTnKCW1JhT_neqXRuML7X17RO8I",
  authDomain: "wave-hris-fb.firebaseapp.com",
  projectId: "wave-hris-fb",
  storageBucket: "wave-hris-fb.firebasestorage.app",
  messagingSenderId: "1059074578468",
  appId: "1:1059074578468:web:37da08fc701e090cf3e0b1",
};

export const STAGING_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: "AIzaSyDlcEaVvILY13VjEjJb5KXVcqmjWiGaEy0",
  authDomain: "wave-hris-staging-fb.firebaseapp.com",
  projectId: "wave-hris-staging-fb",
  storageBucket: "wave-hris-staging-fb.firebasestorage.app",
  messagingSenderId: "748671204610",
  appId: "1:748671204610:web:95922faf1829ec3eff561b",
};

// Resolve the config for the current environment. Reads APP_ENV, so it only makes
// sense server-side (during SSR); the guard keeps it inert if ever evaluated in a
// browser bundle. The result is injected into the page (window.__FIREBASE_CONFIG__)
// so the client SDK mints tokens against the right project.
export function resolveFirebaseConfig(): FirebaseOptions {
  const env = typeof process !== "undefined" ? process.env.APP_ENV : undefined;
  return env === "staging" ? STAGING_FIREBASE_CONFIG : PROD_FIREBASE_CONFIG;
}
