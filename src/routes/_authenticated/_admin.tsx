import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/_admin")({ component: AdminGate });

function AdminGate() {
  const { isHR, loading, rolesLoading, user } = useAuth();
  if (loading || (user && rolesLoading)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="font-display text-2xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isHR) return <Navigate to="/dashboard" />;
  return <Outlet />;
}
