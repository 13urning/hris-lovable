import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, Clock3, LayoutDashboard, Users, CalendarRange, ClipboardCheck, Plane, BarChart3, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import tidalLogo from "@/assets/tidal-logo.png";

export function AppShell() {
  const { user, isHR, isGroupHead, signOut } = useAuth();
  const router = useRouter();
  const path = router.state.location.pathname;

  const navItem = (to: string, label: string, Icon: typeof Clock3) => (
    <Link
      key={to} to={to}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        path === to || path.startsWith(to + "/")
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src={tidalLogo} alt="Tidal Solutions" className="h-8 w-auto" />
            <span className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:inline">/ DTR</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItem("/dashboard", "Dashboard", LayoutDashboard)}
            {!isHR && navItem("/dtr", "My DTR", Clock3)}
            {navItem("/leaves", "Leaves", Plane)}
            {!isGroupHead && navItem("/performance", "Performance", BarChart3)}
            {isHR && navItem("/cutoff-approval", "Cut Off Approval", ClipboardCheck)}
            {isHR && navItem("/cutoffs", "Cutoffs", CalendarRange)}
            {isHR && navItem("/employees", "Employees", Users)}
            {isGroupHead && navItem("/kpi-builder", "KPI Builder", Target)}
            {isGroupHead && navItem("/performance-admin", "Performance", BarChart3)}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { signOut(); }}>
              <LogOut className="mr-1.5 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t px-4 py-2 md:hidden">
          {navItem("/dashboard", "Dashboard", LayoutDashboard)}
          {!isHR && navItem("/dtr", "My DTR", Clock3)}
          {navItem("/leaves", "Leaves", Plane)}
          {!isGroupHead && navItem("/performance", "Performance", BarChart3)}
          {isHR && navItem("/cutoff-approval", "Approvals", ClipboardCheck)}
          {isHR && navItem("/cutoffs", "Cutoffs", CalendarRange)}
          {isHR && navItem("/employees", "Employees", Users)}
          {isGroupHead && navItem("/kpi-builder", "KPIs", Target)}
          {isGroupHead && navItem("/performance-admin", "Performance", BarChart3)}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
