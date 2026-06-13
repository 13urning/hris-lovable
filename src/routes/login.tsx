import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import tidalLogo from "@/assets/tidal-logo.png";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { isAuthenticated, loading, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!loading && isAuthenticated) return <Navigate to="/dashboard" />;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#024f50] via-[#036a6b] to-[#15a6a1] p-6">
      {/* Decorative wave flourish, echoes the reference brand art */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-24 top-0 h-[140%] w-[70%] text-white/10"
        viewBox="0 0 600 800"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M-50 250 C 150 150, 350 350, 650 200"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M-50 350 C 200 220, 420 480, 700 300"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand lockup */}
        <div className="mb-8 text-center">
          <img
            src={tidalLogo}
            alt="Tidal Solutions"
            className="mx-auto h-11 w-auto brightness-0 invert"
          />
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-white/80">
            Wave HRIS
          </p>
        </div>

        {/* Sign-in card */}
        <div className="rounded-3xl bg-white p-8 shadow-2xl shadow-black/25 sm:p-10">
          <div className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-secondary/60 px-4 py-3 text-primary">
            <Mail className="h-4 w-4" />
            <span className="text-sm font-semibold">Email sign-in</span>
          </div>

          <form onSubmit={handleSignIn} className="space-y-5">
            <div>
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@tidalsolutions.com"
                className="mt-1.5 h-12 rounded-xl border-input/80 bg-background px-4 text-base"
              />
            </div>
            <div>
              <Label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1.5 h-12 rounded-xl border-input/80 bg-background px-4 text-base"
              />
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-xl bg-primary text-base font-semibold hover:bg-primary/90"
            >
              {busy ? (
                "Signing in…"
              ) : (
                <>
                  <ArrowRight className="mr-2 h-5 w-5" /> Sign in
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            For tracking attendance, filing leaves, and overtime.
          </p>
        </div>

        {/* Footnote */}
        <p className="mx-auto mt-8 max-w-sm text-center text-sm text-white/70">
          Employee? Sign in with the email &amp; password your HR team set up for
          you.
        </p>
      </div>
    </div>
  );
}
