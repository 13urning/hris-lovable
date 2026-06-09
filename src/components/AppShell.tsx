import { useState } from "react";
import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  LogOut, Clock3, LayoutDashboard, Users,
  Plane, BarChart3, Target, Menu, GitBranch, Timer, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import tidalLogo from "@/assets/tidal-logo.png";

export function AppShell() {
  const { user, isHR, isAdmin, isGroupHead, signOut } = useAuth();
  const router = useRouter();
  const path = router.state.location.pathname;
  const [sheetOpen, setSheetOpen] = useState(false);

  const isElevated = isHR || isAdmin || isGroupHead;

  // Inline nav link used in the horizontal bar (regular employees, md+)
  const navItem = (to: string, label: string, Icon: typeof Clock3) => (
    <Link
      key={to}
      to={to}
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

  // Nav link used inside the Sheet drawer
  const drawerItem = (to: string, label: string, Icon: typeof Clock3) => (
    <Link
      key={to}
      to={to}
      onClick={() => setSheetOpen(false)}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        path === to || path.startsWith(to + "/")
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-secondary",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );

  const sectionLabel = (label: string) => (
    <p className="text-xs uppercase tracking-widest text-muted-foreground px-3 py-1 mt-4 first:mt-0">
      {label}
    </p>
  );

  // Hamburger drawer — used for elevated users at all widths, and for all users below md
  const hamburgerTrigger = (
    <Button variant="ghost" size="icon" aria-label="Open menu">
      <Menu className="h-5 w-5" />
    </Button>
  );

  const drawerNav = (
    <nav className="flex flex-col gap-0.5 pt-2">
      {sectionLabel("My Account")}
      {drawerItem("/dashboard", "Dashboard", LayoutDashboard)}

      {sectionLabel("Attendance")}
      {drawerItem("/dtr", "Attendance", Clock3)}

      {sectionLabel("People")}
      {isHR && drawerItem("/employees", "Employees", Users)}
      {isHR && drawerItem("/activity-log", "Activity Log", Activity)}
      {isAdmin && drawerItem("/org-chart", "Org Chart", GitBranch)}

      {sectionLabel("Overtime")}
      {drawerItem("/ot-approvals", "OT Approvals", Timer)}

      {sectionLabel("Performance")}
      {isGroupHead && drawerItem("/kpi-builder", "KPI Builder", Target)}
      {isGroupHead && drawerItem("/performance-admin", "Performance Admin", BarChart3)}
      {!isElevated && drawerItem("/performance", "Performance", BarChart3)}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          {/* Left: logo + hamburger for elevated users */}
          <div className="flex items-center gap-2">
            {/* Hamburger: elevated users always; all users below md */}
            <div className={cn(isElevated ? "block" : "block md:hidden")}>
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>{hamburgerTrigger}</SheetTrigger>
                <SheetContent side="left" className="w-64 p-4">
                  <SheetHeader>
                    <SheetTitle>Menu</SheetTitle>
                  </SheetHeader>
                  {drawerNav}
                </SheetContent>
              </Sheet>
            </div>

            <Link to="/dashboard" className="flex items-center gap-2">
              <img src={tidalLogo} alt="Tidal Solutions" className="h-8 w-auto" />
              <span className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground sm:inline">
                Wave HRIS
              </span>
            </Link>
          </div>

          {/* Center: horizontal nav for regular employees, md+ only */}
          {!isElevated && (
            <nav className="hidden items-center gap-1 md:flex">
              {navItem("/dashboard", "Dashboard", LayoutDashboard)}
              {navItem("/dtr", "Attendance", Clock3)}
              {navItem("/leaves", "Leaves", Plane)}
              {navItem("/performance", "Performance", BarChart3)}
              {navItem("/ot-approvals", "OT Approvals", Timer)}
            </nav>
          )}
          {/* Center: horizontal nav for HR/admin, md+ only */}
          {isElevated && (
            <nav className="hidden items-center gap-1 md:flex">
              {navItem("/dashboard", "Dashboard", LayoutDashboard)}
              {navItem("/dtr", "Attendance", Clock3)}
              {navItem("/ot-approvals", "OT Approvals", Timer)}
            </nav>
          )}

          {/* Right: email + sign out */}
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { signOut(); }}>
              <LogOut className="mr-1.5 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
