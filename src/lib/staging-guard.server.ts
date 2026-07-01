// Interim tripwire. Staging currently SHARES the wave-hris-fb Firebase Auth pool
// with production, so any adminAuth create/update/delete mutates the shared
// identity and can damage PROD accounts (a staging password reset changed a
// prod user's password; a staging delete would lock them out of prod entirely).
//
// This blocks those destructive shared-pool writes on staging until staging has
// its own dedicated Firebase project. It is deliberately minimal and reversible:
// once staging points at its own project (FIREBASE_PROJECT_ID flipped at cutover),
// mutating "the shared pool" is no longer true, so these calls are removed as the
// final migration step.
export function assertNotStagingFirebase(op: string): void {
  if (process.env.APP_ENV === "staging") {
    throw new Error(
      `BLOCKED_ON_STAGING: "${op}" changes the Firebase login, which is shared ` +
        `with production, so it would affect the real user's production account. ` +
        `Disabled on staging until staging has its own Firebase project.`,
    );
  }
}
