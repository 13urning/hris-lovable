import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({ component: Gate });

function Gate() {
  const { loading, isAuthenticated, rolesInitialized } = useAuth();
  // Keep the loading screen until both the session check AND the first role fetch are done.
  // This prevents a brief redirect to /login during the initial load race, and ensures
  // rolesInitialized is permanently true afterwards so this block never re-enters.
  if (loading || !rolesInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-display text-3xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;
  return <AppShell />;
}
