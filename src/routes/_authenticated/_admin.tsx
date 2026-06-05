import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/_admin")({ component: AdminGate });

function AdminGate() {
  const { isHR, loading, rolesLoading, rolesInitialized, user } = useAuth();
  // Only block on loading for the very first role fetch — not on subsequent token-refresh re-fetches,
  // which would unmount the outlet and destroy open modal/section state.
  if (loading || (user && rolesLoading && !rolesInitialized)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="font-display text-2xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isHR) return <Navigate to="/dashboard" />;
  return <Outlet />;
}
