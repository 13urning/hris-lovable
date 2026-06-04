import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import tidalLogo from "@/assets/tidal-logo.png";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  const { isAuthenticated, isHR, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img src={tidalLogo} alt="Tidal Solutions" className="h-10 w-auto opacity-80" />
      </div>
    );
  }
  return <Navigate to={isAuthenticated ? (isHR ? "/cutoff-approval" : "/dashboard") : "/login"} />;
}
