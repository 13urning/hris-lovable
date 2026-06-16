import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivityLogDTRs, getTodayRoster } from "@/lib/dtr-functions";
import { TablePagination } from "@/components/TablePagination";
import { usePagination } from "@/hooks/use-pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock3,
  FileDown,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  CalendarClock,
  UserX,
} from "lucide-react";
import { exportRowsToCSV } from "@/lib/csv-export";

export const Route = createFileRoute("/_authenticated/_admin/activity-log")({
  component: ActivityLogPage,
});

type SortKey = "employee" | "date" | "hours" | "late" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" };

// Flag severity for sorting by Status: Late+Undertime (3) > Late (2) >
// Undertime (1) > on-time / in-progress / no-record (0).
function flagScore(e: LogEntry): number {
  if (e.is_absent) return 4; // absences sort to the top of the Status column
  if (!e.time_in) return 0;
  return ((e.late_minutes ?? 0) > 0 ? 2 : 0) + (e.is_undertime ? 1 : 0);
}

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
  late_minutes: number | null;
  created_at: string | null;
  is_absent?: boolean | null;
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
    month: "short",
    day: "numeric",
    year: "numeric",
    weekday: "short",
  });
}

function formatTimestamp(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function SortHeader({
  label,
  sortKey,
  sort,
  setSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  setSort: (updater: (s: SortState) => SortState) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key: sortKey,
            // New column starts descending; same column toggles direction.
            dir: s.key === sortKey && s.dir === "desc" ? "asc" : "desc",
          }))
        }
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "opacity-90" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function ActivityLogPage() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });

  const { data: logs, isLoading } = useQuery({
    queryKey: ["activity-log"],
    queryFn: () => getActivityLogDTRs() as Promise<LogEntry[]>,
  });

  const { data: roster } = useQuery({
    queryKey: ["today-roster"],
    queryFn: () => getTodayRoster(),
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

  // Clock-in records and absences are shown in two separate tables.
  const clockIns = useMemo(() => {
    const cmp = (a: LogEntry, b: LogEntry) => {
      let c = 0;
      switch (sort.key) {
        case "employee":
          c = (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? "");
          break;
        case "hours":
          c = (a.hours_worked ?? 0) - (b.hours_worked ?? 0);
          break;
        case "late":
          c = (a.late_minutes ?? 0) - (b.late_minutes ?? 0);
          break;
        case "status":
          c = flagScore(a) - flagScore(b);
          break;
        case "date":
        default:
          c =
            a.work_date.localeCompare(b.work_date) ||
            (a.time_in ?? "").localeCompare(b.time_in ?? "");
          break;
      }
      if (c === 0)
        c =
          a.work_date.localeCompare(b.work_date) ||
          (a.time_in ?? "").localeCompare(b.time_in ?? "");
      return sort.dir === "asc" ? c : -c;
    };
    return filtered.filter((e) => !e.is_absent).sort(cmp);
  }, [filtered, sort]);

  const absences = useMemo(
    () =>
      filtered
        .filter((e) => e.is_absent)
        .sort(
          (a, b) =>
            b.work_date.localeCompare(a.work_date) ||
            (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? ""),
        ),
    [filtered],
  );

  const clockInPg = usePagination(clockIns, 25);
  const absencePg = usePagination(absences, 25);

  const statusText = (entry: LogEntry) => {
    if (entry.is_absent) return "Absent";
    if (!entry.time_in) return "No record";
    const tags: string[] = [];
    if ((entry.late_minutes ?? 0) > 0) tags.push("Late");
    if (!entry.time_out) tags.push("In progress");
    else if (entry.is_undertime) tags.push("Undertime");
    if (tags.length === 0) tags.push("Present");
    return tags.join(", ");
  };

  const handleExport = () => {
    exportRowsToCSV(
      filtered,
      [
        { header: "Employee", value: (e) => e.profile?.full_name ?? "Unknown" },
        { header: "Employee Code", value: (e) => e.profile?.employee_code ?? "" },
        { header: "Department", value: (e) => e.profile?.department ?? "" },
        { header: "Date", value: (e) => e.work_date },
        { header: "Shift", value: (e) => e.shift_label ?? "" },
        { header: "Clock In", value: (e) => formatTime(e.time_in) },
        { header: "Clock In Timestamp", value: (e) => formatTimestamp(e.created_at) },
        { header: "Clock Out", value: (e) => formatTime(e.time_out) },
        {
          header: "Hours",
          value: (e) => (e.hours_worked != null ? e.hours_worked.toFixed(2) : ""),
        },
        { header: "Late (min)", value: (e) => e.late_minutes ?? 0 },
        { header: "Undertime (min)", value: (e) => e.undertime_minutes ?? "" },
        { header: "Status", value: statusText },
      ],
      "activity-log",
    );
  };

  const statusBadges = (entry: LogEntry) => {
    if (entry.is_absent)
      return (
        <Badge className="bg-red-100 text-red-800 border border-red-200 hover:bg-red-100">
          Absent
        </Badge>
      );
    if (!entry.time_in)
      return (
        <Badge variant="outline" className="text-muted-foreground">
          No record
        </Badge>
      );
    const badges: ReactNode[] = [];
    if ((entry.late_minutes ?? 0) > 0)
      badges.push(
        <Badge
          key="late"
          className="bg-red-100 text-red-800 border border-red-200 hover:bg-red-100"
        >
          Late
        </Badge>,
      );
    if (!entry.time_out)
      badges.push(
        <Badge key="inprog" variant="secondary">
          In progress
        </Badge>,
      );
    else if (entry.is_undertime)
      badges.push(
        <Badge
          key="under"
          className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100"
        >
          Undertime
        </Badge>,
      );
    if (badges.length === 0)
      badges.push(
        <Badge
          key="present"
          className="bg-green-50 text-green-700 border border-green-200 hover:bg-green-50"
        >
          Present
        </Badge>,
      );
    return <div className="flex flex-wrap gap-1">{badges}</div>;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">People</p>
        <h1 className="mt-1 font-display text-4xl">Clock-In Activity Log</h1>
      </div>

      {/* Today's live roster — who is in, on leave, or not yet clocked in */}
      {roster && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="h-4 w-4" /> Today — {formatDate(roster.date)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {roster.holidayName ? (
              <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
                🎉 Holiday — <span className="font-medium">{roster.holidayName}</span>. No
                attendance expected today.
              </p>
            ) : roster.isWeekend ? (
              <p className="rounded-md border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                Rest day (weekend). No attendance expected today.
              </p>
            ) : (
              (() => {
                const emps = roster.employees;
                const present = emps.filter((e) => e.status === "present").length;
                const onLeave = emps.filter((e) => e.status === "leave").length;
                const pending = emps.filter((e) => e.status === "pending");
                const stat = (label: string, value: number, tone?: "ok" | "warn") => (
                  <div className="rounded-md border bg-background/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p
                      className={`mt-1 font-display text-2xl ${tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : ""}`}
                    >
                      {value}
                    </p>
                  </div>
                );
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      {stat("Clocked in", present, "ok")}
                      {stat("On leave", onLeave)}
                      {stat("Not yet in", pending.length, pending.length ? "warn" : undefined)}
                    </div>
                    {pending.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Everyone is accounted for. ✅</p>
                    ) : (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                          <UserX className="h-4 w-4 text-amber-600" />
                          Not yet clocked in ({pending.length}) — counts as absent at end of day
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {pending.map((e) => (
                            <span
                              key={e.id}
                              className="rounded-md border bg-amber-50 px-2 py-1 text-xs"
                            >
                              {e.full_name}
                              {e.department ? ` · ${e.department}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              {isLoading ? "Loading…" : `Clock-In Records · ${clockIns.length}`}
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
              <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
                <FileDown className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortHeader label="Employee" sortKey="employee" sort={sort} setSort={setSort} />
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <SortHeader label="Date" sortKey="date" sort={sort} setSort={setSort} />
                <th className="px-3 py-2 text-center font-medium">Shift</th>
                <th className="px-3 py-2 text-left font-medium">Clock In</th>
                <th className="px-3 py-2 text-left font-medium">Clock Out</th>
                <SortHeader
                  label="Hours"
                  sortKey="hours"
                  sort={sort}
                  setSort={setSort}
                  align="right"
                />
                <SortHeader
                  label="Late"
                  sortKey="late"
                  sort={sort}
                  setSort={setSort}
                  align="right"
                />
                <SortHeader label="Status" sortKey="status" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {clockInPg.pageItems.map((entry) => {
                const late = (entry.late_minutes ?? 0) > 0;
                return (
                  <tr
                    key={entry.id}
                    className={`border-t align-top ${entry.is_absent ? "bg-red-50/50" : late ? "bg-red-50/30" : entry.is_undertime ? "bg-amber-50/30" : ""}`}
                  >
                    {/* Employee — name over code so long names don't wrap awkwardly */}
                    <td className="px-3 py-3">
                      <div className="font-medium leading-tight">
                        {entry.profile?.full_name ?? "Unknown"}
                      </div>
                      {entry.profile?.employee_code && (
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {entry.profile.employee_code}
                        </div>
                      )}
                    </td>
                    {/* Department */}
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {entry.profile?.department ?? "—"}
                    </td>
                    {/* Date */}
                    <td className="whitespace-nowrap px-3 py-3 text-xs">
                      {formatDate(entry.work_date)}
                    </td>
                    {/* Shift */}
                    <td className="px-3 py-3 text-center">
                      {entry.shift_label ? (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                          {entry.shift_label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {/* Clock In (time + full timestamp subtitle) */}
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="tabular-nums">{formatTime(entry.time_in)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatTimestamp(entry.created_at)}
                      </div>
                    </td>
                    {/* Clock Out */}
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {formatTime(entry.time_out)}
                    </td>
                    {/* Hours */}
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {entry.hours_worked != null ? (
                        <span className={entry.is_undertime ? "font-medium text-amber-700" : ""}>
                          {entry.hours_worked.toFixed(2)}h
                          {entry.is_undertime && entry.undertime_minutes != null && (
                            <span className="ml-1 text-xs text-amber-600">
                              (−{entry.undertime_minutes}m)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {/* Late */}
                    <td className="px-3 py-3 text-right tabular-nums">
                      {late ? (
                        <span className="font-medium text-red-600">{entry.late_minutes}m</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {/* Status */}
                    <td className="px-3 py-3">{statusBadges(entry)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!isLoading && clockIns.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search || dateFrom || dateTo
                ? "No clock-in records match your filters."
                : "No clock-in activity recorded yet."}
            </div>
          )}
          {isLoading && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Loading activity…
            </div>
          )}
          <TablePagination
            page={clockInPg.page}
            pageCount={clockInPg.pageCount}
            pageSize={clockInPg.pageSize}
            total={clockInPg.total}
            start={clockInPg.start}
            pageItemsCount={clockInPg.pageItems.length}
            onPageChange={clockInPg.setPage}
            onPageSizeChange={clockInPg.setPageSize}
          />
        </CardContent>
      </Card>

      {/* Absences — past workdays with no clock-in and no leave (last 30 days) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-4 w-4 text-red-600" />
            {isLoading ? "Loading…" : `Absences · ${absences.length}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Employee</th>
                <th className="px-3 py-2 text-left font-medium">Department</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {absencePg.pageItems.map((entry) => (
                <tr key={entry.id} className="border-t bg-red-50/40 align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium leading-tight">
                      {entry.profile?.full_name ?? "Unknown"}
                    </div>
                    {entry.profile?.employee_code && (
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {entry.profile.employee_code}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {entry.profile?.department ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    {formatDate(entry.work_date)}
                  </td>
                  <td className="px-3 py-3">
                    <Badge className="bg-red-100 text-red-800 border border-red-200 hover:bg-red-100">
                      Absent
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && absences.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search || dateFrom || dateTo
                ? "No absences match your filters."
                : "No absences in the last 30 days. 🎉"}
            </div>
          )}
          <TablePagination
            page={absencePg.page}
            pageCount={absencePg.pageCount}
            pageSize={absencePg.pageSize}
            total={absencePg.total}
            start={absencePg.start}
            pageItemsCount={absencePg.pageItems.length}
            onPageChange={absencePg.setPage}
            onPageSizeChange={absencePg.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
