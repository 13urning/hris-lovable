import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Clock3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/activity-log")({ component: ActivityLogPage });

type LogEntry = {
  id: string;
  employee_id: string;
  work_date: string;
  time_in: string | null;
  time_out: string | null;
  hours_worked: number | null;
  shift_label: string | null;
  is_undertime: boolean | null;
  undertime_minutes: number | null;
  created_at: string | null;
  profile: {
    full_name: string;
    employee_code: string | null;
    department: string | null;
  } | null;
};

function formatTime(t: string | null) {
  if (!t) return "—";
  // Convert HH:MM to 12-hr format
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric", weekday: "short",
  });
}

function formatTimestamp(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function ActivityLogPage() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["activity-log"],
    queryFn: async (): Promise<LogEntry[]> => {
      const { data, error } = await supabase
        .from("daily_time_reports")
        .select(`
          id, employee_id, work_date, time_in, time_out,
          hours_worked, shift_label, is_undertime, undertime_minutes, created_at,
          profiles!employee_id(full_name, employee_code, department)
        `)
        .order("work_date", { ascending: false })
        .order("time_in", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        profile: Array.isArray(row.profiles)
          ? (row.profiles[0] ?? null)
          : (row.profiles ?? null),
      })) as LogEntry[];
    },
  });

  const filtered = (logs ?? []).filter((entry) => {
    if (search) {
      const q = search.toLowerCase();
      const name = entry.profile?.full_name?.toLowerCase() ?? "";
      const code = entry.profile?.employee_code?.toLowerCase() ?? "";
      const dept = entry.profile?.department?.toLowerCase() ?? "";
      if (!name.includes(q) && !code.includes(q) && !dept.includes(q)) return false;
    }
    if (dateFrom && entry.work_date < dateFrom) return false;
    if (dateTo && entry.work_date > dateTo) return false;
    return true;
  });

  const statusBadge = (entry: LogEntry) => {
    if (!entry.time_in) return <Badge variant="outline" className="text-muted-foreground">No record</Badge>;
    if (!entry.time_out) return <Badge variant="secondary">In progress</Badge>;
    if (entry.is_undertime) return <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100">Undertime</Badge>;
    return <Badge className="bg-green-50 text-green-700 border border-green-200 hover:bg-green-50">Present</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">People</p>
        <h1 className="mt-1 font-display text-4xl">Clock-In Activity Log</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              {isLoading ? "Loading…" : `${filtered.length} entries`}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder="Search name, code, dept…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span>From</span>
                <Input
                  type="date"
                  className="w-36"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
                <span>To</span>
                <Input
                  type="date"
                  className="w-36"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-left">Clock In</th>
                <th className="px-3 py-2 text-left">Clock In Timestamp</th>
                <th className="px-3 py-2 text-left">Clock Out</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className={`border-t ${entry.is_undertime ? "bg-amber-50/30" : ""}`}>
                  {/* Employee */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.profile?.full_name ?? "Unknown"}</span>
                      {entry.profile?.employee_code && (
                        <span className="text-xs font-mono bg-secondary/60 px-1.5 py-0.5 rounded text-muted-foreground">
                          {entry.profile.employee_code}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Department */}
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {entry.profile?.department ?? "—"}
                  </td>
                  {/* Date */}
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {formatDate(entry.work_date)}
                  </td>
                  {/* Shift */}
                  <td className="px-3 py-2">
                    {entry.shift_label ? (
                      <span className="text-xs bg-secondary px-1.5 py-0.5 rounded font-medium">{entry.shift_label}</span>
                    ) : "—"}
                  </td>
                  {/* Clock In time */}
                  <td className="px-3 py-2 tabular-nums">
                    {formatTime(entry.time_in)}
                  </td>
                  {/* Clock In full timestamp */}
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(entry.created_at)}
                  </td>
                  {/* Clock Out */}
                  <td className="px-3 py-2 tabular-nums">
                    {formatTime(entry.time_out)}
                  </td>
                  {/* Hours */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {entry.hours_worked != null ? (
                      <span className={entry.is_undertime ? "text-amber-700 font-medium" : ""}>
                        {entry.hours_worked.toFixed(2)}h
                        {entry.is_undertime && entry.undertime_minutes != null && (
                          <span className="ml-1 text-xs text-amber-600">
                            (−{entry.undertime_minutes}m)
                          </span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  {/* Status */}
                  <td className="px-3 py-2">
                    {statusBadge(entry)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!isLoading && filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search || dateFrom || dateTo
                ? "No entries match your filters."
                : "No clock-in activity recorded yet."}
            </div>
          )}
          {isLoading && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Loading activity…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
