import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  SESSION_WARN_MS,
  clearSession,
  ensureSessionStarted,
  markActivity,
  msUntilExpiry,
} from "@/lib/session";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"];

// Enforces the login-session lifetime (see lib/session.ts): tracks activity,
// warns ~1 min before expiry, and signs the user out when the session lapses —
// which drops them back to the login page via the auth gate.
export function SessionGuard() {
  const { user, signOut } = useAuth();
  // Seconds remaining while the warning is showing; null = no warning.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const expiringRef = useRef(false);

  // Stamp session start/activity once authenticated (preserved across reloads).
  useEffect(() => {
    if (!user) return;
    expiringRef.current = false;
    ensureSessionStarted();
  }, [user]);

  // Record activity (throttled) to keep the idle clock fresh.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < 5000) return; // throttle writes to once / 5s
      lastWrite = now;
      markActivity(now);
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, [user]);

  const endSession = useCallback(
    async (message?: string) => {
      if (expiringRef.current) return;
      expiringRef.current = true;
      setSecondsLeft(null);
      clearSession();
      if (message) toast.error(message);
      await signOut(); // flips isAuthenticated → auth gate redirects to /login
    },
    [signOut],
  );

  const staySignedIn = useCallback(() => {
    markActivity();
    setSecondsLeft(null);
  }, []);

  // Poll the deadline once a second to drive the countdown + trigger logout.
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      const msLeft = msUntilExpiry();
      if (msLeft <= 0) {
        void endSession("Your session expired. Please sign in again.");
      } else if (msLeft <= SESSION_WARN_MS) {
        setSecondsLeft(Math.ceil(msLeft / 1000));
      } else {
        setSecondsLeft(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [user, endSession]);

  if (!user || secondsLeft == null) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && staySignedIn()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning-foreground" />
            Session about to expire
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          For your security you'll be signed out in{" "}
          <span className="font-semibold tabular-nums text-foreground">{secondsLeft}s</span>. Choose
          "Stay signed in" to continue.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => void endSession()}>
            Log out now
          </Button>
          <Button onClick={staySignedIn}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
