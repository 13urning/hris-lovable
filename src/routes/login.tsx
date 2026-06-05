import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import tidalLogo from "@/assets/tidal-logo.png";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { isAuthenticated, loading, isHR, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  if (!loading && isAuthenticated) return <Navigate to="/dashboard" />;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else { toast.success("Welcome back"); navigate({ to: "/dashboard" }); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) toast.error(error);
    else { toast.success("Account created"); navigate({ to: "/dashboard" }); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-sm">
        <img src={tidalLogo} alt="Tidal Solutions" className="mx-auto mb-8 h-10 w-auto" />
          <h2 className="font-display text-3xl">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor attendance, leaves, OT, and performance.
          </p>
          <Tabs defaultValue="signin" className="mt-8">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="email2">Email</Label>
                  <Input id="email2" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="password2">Password</Label>
                  <Input id="password2" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  New accounts start with the <strong>employee</strong> role. An admin can promote you to HR / Admin from the Employees page.
                </p>
              </form>
            </TabsContent>
          </Tabs>
      </div>
    </div>
  );
}
