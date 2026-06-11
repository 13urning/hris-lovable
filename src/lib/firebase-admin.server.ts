import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// verifyIdToken only needs the project ID — it fetches Google's public JWKS
// to validate signatures. Admin write operations (deleteUser, etc.) require
// real credentials, which we get from Application Default Credentials:
//   • On Cloud Run, ADC is the runtime SA — granted roles/firebaseauth.admin
//     on the wave-hris-fb project.
//   • Locally, set GOOGLE_APPLICATION_CREDENTIALS to a SA key file with the
//     same role, or run `gcloud auth application-default login`.
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? "wave-hris-fb",
    credential: applicationDefault(),
  });
}

export const adminAuth = getAuth();
