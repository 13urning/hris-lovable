import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { todayIso } from "@/lib/dtr";
import {
  getAdminDashboardStats,
  getAdminAttendanceRoster,
  type RosterEntry,
} from "@/lib/admin-dashboard-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  UserCheck,
  UserX,
  Plane,
  AlertCircle,
  Clock3,
  Scale,
  Timer,
  Building2,
  ArrowRight,
} from "lucide-react";

export type RosterCategory = "present" | "onLeave" | "notClockedIn" | "late";

export function MetricCard({
  icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "warn" | "danger" | "success" | "accent";
  onClick?: () => void;
}) {
  const valueTone =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-warning-foreground"
        : tone === "success"
          ? "text-success"
          : tone === "accent"
            ? "text-accent"
            : "";
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`mt-1 font-display text-3xl tabular-nums ${valueTone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg border bg-background/60 p-4 text-left transition-colors hover:bg-secondary/50 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </button>
    );
  }
  return <div className="rounded-lg border bg-background/60 p-4">{body}</div>;
}

// Pending-approval tile: links to the relevant queue and highlights when the
// count is non-zero so an admin can see at a glance what needs attention.
export function ApprovalTile({
  to,
  label,
  count,
  icon,
}: {
  to: string;
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <Link
      to={to as never}
      className={`flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-secondary/40 ${
        active ? "border-warning/40 bg-warning/5" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${
            active ? "bg-warning/20 text-warning-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          {icon}
        </span>
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {active ? `${count} awaiting review` : "All caught up"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-display text-2xl tabular-nums ${active ? "" : "text-muted-foreground"}`}>
          {count}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

const QUICK_LINKS = [
  { to: "/employees", label: "Employees", desc: "Profiles, roles, and leave credits" },
  { to: "/org-chart", label: "Org Chart", desc: "Visualise the reporting hierarchy" },
  { to: "/ot-approvals", label: "OT Approvals", desc: "Review OT budget and filed hours" },
  { to: "/leaves", label: "Leave Requests", desc: "Review and approve employee leave" },
  { to: "/kpi-builder", label: "KPI Builder", desc: "Build and manage KPI templates" },
  { to: "/performance-admin", label: "Performance", desc: "Review performance evaluations" },
];

export function AdminDashboard() {
  const { user } = useAuth();
  const today = todayIso();
  const monthStart = today.slice(0, 7) + "-01";
  const monthLabel = new Date(monthStart + "T00:00:00").toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-dashboard-stats", user?.id, today],
    enabled: !!user,
    queryFn: () => getAdminDashboardStats({ data: { today, monthStart } }),
  });

  // Drill-down: which roster category the admin clicked (null = closed). The
  // roster is fetched once and cached; switching categories reuses it.
  const [rosterCat, setRosterCat] = useState<RosterCategory | null>(null);
  const { data: roster, isLoading: rosterLoading } = useQuery({
    queryKey: ["admin-attendance-roster", user?.id, today],
    enabled: !!user && rosterCat !== null,
    queryFn: () => getAdminAttendanceRoster({ data: { today } }),
  });

  if (isLoading || !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const attendancePct =
    stats.totalEmployees > 0
      ? Math.round(((stats.presentToday + stats.onLeaveToday) / stats.totalEmployees) * 100)
      : 0;
  const maxDept = Math.max(1, ...stats.byDepartment.map((d) => d.count));

  return (
    <div className="space-y-6">
      {/* Today at a glance */}
      <div>
        <h2 className="font-display text-2xl">Today at a glance</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            icon={<Users className="h-4 w-4" />}
            label="Employees"
            value={stats.totalEmployees}
            sub={`${attendancePct}% accounted for`}
          />
          <MetricCard
            icon={<UserCheck className="h-4 w-4" />}
            label="Present"
            value={stats.presentToday}
            sub={`${stats.stillClockedIn} still clocked in`}
            tone="success"
            onClick={() => setRosterCat("present")}
          />
          <MetricCard
            icon={<Plane className="h-4 w-4" />}
            label="On leave"
            value={stats.onLeaveToday}
            tone={stats.onLeaveToday > 0 ? "accent" : undefined}
            onClick={() => setRosterCat("onLeave")}
          />
          <MetricCard
            icon={<UserX className="h-4 w-4" />}
            label="Not clocked in"
            value={stats.notClockedIn}
            tone={stats.notClockedIn > 0 ? "warn" : undefined}
            onClick={() => setRosterCat("notClockedIn")}
          />
          <MetricCard
            icon={<AlertCircle className="h-4 w-4" />}
            label="Late today"
            value={stats.lateToday}
            tone={stats.lateToday > 0 ? "danger" : undefined}
            onClick={() => setRosterCat("late")}
          />
        </div>
      </div>

      {/* Pending approvals */}
      <div>
        <h2 className="font-display text-2xl">Pending approvals</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ApprovalTile
            to="/leaves"
            label="Leave requests"
            count={stats.pendingLeaves}
            icon={<Plane className="h-4 w-4" />}
          />
          <ApprovalTile
            to="/ot-approvals"
            label="OT requests"
            count={stats.pendingOT}
            icon={<Clock3 className="h-4 w-4" />}
          />
          <ApprovalTile
            to="/dtr"
            label="Attendance disputes"
            count={stats.pendingDisputes}
            icon={<Scale className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* This month + headcount */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Timer className="h-4 w-4 text-accent" /> {monthLabel} so far
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<Clock3 className="h-4 w-4" />}
                label="Hours worked"
                value={stats.monthHours.toFixed(0)}
              />
              <MetricCard
                icon={<Timer className="h-4 w-4" />}
                label="OT hours"
                value={stats.monthOtHours.toFixed(1)}
                tone="accent"
              />
              <MetricCard
                icon={<AlertCircle className="h-4 w-4" />}
                label="Late incidents"
                value={stats.monthLateCount}
                tone={stats.monthLateCount > 0 ? "warn" : undefined}
              />
              <MetricCard
                icon={<AlertCircle className="h-4 w-4" />}
                label="Undertime days"
                value={stats.monthUndertimeCount}
                tone={stats.monthUndertimeCount > 0 ? "warn" : undefined}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Building2 className="h-4 w-4 text-accent" /> Headcount by department
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byDepartment.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employees yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {stats.byDepartment.slice(0, 8).map((d) => (
                  <li key={d.department}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{d.department}</span>
                      <span className="tabular-nums text-muted-foreground">{d.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.round((d.count / maxDept) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="font-display text-2xl">Manage</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map(({ to, label, desc }) => (
            <Link
              key={to}
              to={to as never}
              className="rounded-lg border bg-card p-5 transition-colors hover:bg-secondary/40"
            >
              <p className="font-semibold">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <RosterDialog
        category={rosterCat}
        onClose={() => setRosterCat(null)}
        roster={roster}
        loading={rosterLoading}
      />
    </div>
  );
}

const ROSTER_TITLES: Record<RosterCategory, string> = {
  present: "Present today",
  onLeave: "On leave today",
  notClockedIn: "Not clocked in",
  late: "Late today",
};

function entriesFor(
  category: RosterCategory,
  roster: { present: RosterEntry[]; onLeave: RosterEntry[]; notClockedIn: RosterEntry[] },
): RosterEntry[] {
  switch (category) {
    case "present":
      return roster.present;
    case "late":
      return roster.present.filter((e) => e.lateMinutes > 0);
    case "onLeave":
      return roster.onLeave;
    case "notClockedIn":
      return roster.notClockedIn;
  }
}

// Right-aligned detail line per category (time worked, leave type, etc.).
function EntryDetail({ category, e }: { category: RosterCategory; e: RosterEntry }) {
  if (category === "onLeave") {
    return (
      <span className="text-xs text-muted-foreground">
        {e.leaveType}
        {e.halfDay ? ` · half day (${e.halfDayPeriod})` : ""}
        {e.leaveEnd ? ` · until ${e.leaveEnd}` : ""}
      </span>
    );
  }
  if (category === "notClockedIn") {
    return null;
  }
  // present / late
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span>
        {e.timeIn ?? "—"} → {e.timeOut ?? "still in"}
      </span>
      {e.lateMinutes > 0 && (
        <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
          {e.lateMinutes}m late
        </span>
      )}
    </span>
  );
}

export function RosterDialog({
  category,
  onClose,
  roster,
  loading,
}: {
  category: RosterCategory | null;
  onClose: () => void;
  roster: { present: RosterEntry[]; onLeave: RosterEntry[]; notClockedIn: RosterEntry[] } | undefined;
  loading: boolean;
}) {
  const entries = category && roster ? entriesFor(category, roster) : [];
  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {category ? ROSTER_TITLES[category] : ""}
            {category && roster ? ` (${entries.length})` : ""}
          </DialogTitle>
        </DialogHeader>
        {loading || !roster ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No one in this list.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.department ?? "Unassigned"}
                  </p>
                </div>
                {category && <EntryDetail category={category} e={e} />}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
