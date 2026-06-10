import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// verifyIdToken only needs the project ID — it fetches Google's public JWKS
// to validate signatures. No service account credentials required for verify.
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? "wave-hris-fb",
  });
}

export const adminAuth = getAuth();
