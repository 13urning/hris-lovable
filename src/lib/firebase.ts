import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { PROD_FIREBASE_CONFIG } from "@/lib/firebase-config";

// The per-environment config is injected by the SSR shell as window.__FIREBASE_CONFIG__
// (see __root.tsx / firebase-config.ts). This module is only ever imported in the
// browser, so that global is present; PROD is a defensive fallback.
const firebaseConfig: FirebaseOptions =
  (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || PROD_FIREBASE_CONFIG;

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export default app;
