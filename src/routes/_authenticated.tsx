import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { updatePassword } from "firebase/auth";
import { useAuth } from "@/hooks/use-auth";
import { getProfileFlags, clearPasswordChangeFlag } from "@/lib/user-functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({ component: Gate });

// ── Forced first-login password change ───────────────────────────────────────

function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const canSubmit = newPassword.length >= 8 && newPassword === confirm && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await updatePassword(user!.firebaseUser, newPassword);
      await clearPasswordChangeFlag({ data: user!.uid });
      toast.success("Password updated — welcome!");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl">Set your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This is your first login. Please choose a new password before continuing.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
            {tooShort && (
              <p className="text-xs text-destructive">Must be at least 8 characters</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {mismatch && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {busy ? "Saving…" : "Set Password & Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function Gate() {
  const { loading, isAuthenticated, rolesInitialized, user } = useAuth();
  const qc = useQueryClient();

  // Check whether this user must change their password (set for all imported accounts)
  const { data: profileFlags, isLoading: flagsLoading } = useQuery({
    queryKey: ["profile-flags", user?.uid],
    queryFn: () => getProfileFlags({ data: user!.uid }),
    enabled: !!user && rolesInitialized,
    staleTime: Infinity,
  });

  if (loading || !rolesInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-display text-3xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;

  // Wait for the profile flag to load before deciding what to show
  if (flagsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-display text-3xl text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (profileFlags?.must_change_password) {
    return (
      <ForcePasswordChange
        onDone={() => qc.invalidateQueries({ queryKey: ["profile-flags", user!.uid] })}
      />
    );
  }

  return <AppShell />;
}
