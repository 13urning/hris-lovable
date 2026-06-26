import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { todayIso } from "@/lib/dtr";
import { getMyTeamDashboardStats, getMyTeamRoster } from "@/lib/admin-dashboard-functions";
import {
  MetricCard,
  ApprovalTile,
  RosterDialog,
  type RosterCategory,
} from "@/components/AdminDashboard";
import { Users, UserCheck, UserX, Plane, AlertCircle, Clock3, Scale } from "lucide-react";

// Team-lead view for non-HR approvers: a "my team today" glance scoped to the
// user's subordinates, plus the queue of requests waiting on them. Renders
// nothing for people who are neither approvers nor have a team — so it can be
// dropped into the dashboard unconditionally for non-HR users.
export function TeamDashboard() {
  const { user } = useAuth();
  const today = todayIso();

  const { data: stats } = useQuery({
    queryKey: ["team-dashboard-stats", user?.id, today],
    enabled: !!user,
    queryFn: () => getMyTeamDashboardStats({ data: { today } }),
  });

  const [rosterCat, setRosterCat] = useState<RosterCategory | null>(null);
  const { data: roster, isLoading: rosterLoading } = useQuery({
    queryKey: ["team-roster", user?.id, today],
    enabled: !!user && rosterCat !== null,
    queryFn: () => getMyTeamRoster({ data: { today } }),
  });

  if (!stats) return null;
  const anyPending = stats.pendingLeaves + stats.pendingOT + stats.pendingDisputes > 0;
  // Only relevant to approvers / team leads. Everyone else sees nothing here.
  if (!stats.hasTeam && !anyPending) return null;

  const accountedFor =
    stats.teamSize > 0
      ? Math.round(((stats.presentToday + stats.onLeaveToday) / stats.teamSize) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {stats.hasTeam && (
        <div>
          <h2 className="font-display text-2xl">My team today</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard
              icon={<Users className="h-4 w-4" />}
              label="Team"
              value={stats.teamSize}
              sub={`${accountedFor}% accounted for`}
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
      )}

      <div>
        <h2 className="font-display text-2xl">Pending my approval</h2>
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

      <RosterDialog
        category={rosterCat}
        onClose={() => setRosterCat(null)}
        roster={roster}
        loading={rosterLoading}
      />
    </div>
  );
}
