import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listHolidays,
  syncPhilippineHolidays,
  addHoliday,
  setHolidayActive,
  deleteHoliday,
  type Holiday,
} from "@/lib/holiday-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TablePagination } from "@/components/TablePagination";
import { usePagination } from "@/hooks/use-pagination";
import { CalendarDays, Trash2, RefreshCw, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/holidays")({
  component: HolidaysPage,
});

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function HolidaysPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [syncYear, setSyncYear] = useState(String(new Date().getFullYear()));

  const { data: holidays, isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => listHolidays() as Promise<Holiday[]>,
  });

  const pg = usePagination(holidays ?? [], 25);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["holidays"] });
    qc.invalidateQueries({ queryKey: ["upcoming-holidays"] });
  };

  const sync = useMutation({
    mutationFn: () => syncPhilippineHolidays({ data: { year: Number(syncYear) } }),
    onSuccess: (r) => {
      toast.success(`Synced ${r.year}: ${r.added} new of ${r.fetched} PH holidays`);
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "HOLIDAY_API_FAILED"
          ? "Couldn't reach the holiday service. Try again."
          : e.message,
      ),
  });

  const add = useMutation({
    mutationFn: () => addHoliday({ data: { date, name } }),
    onSuccess: () => {
      toast.success("Holiday added");
      setDate("");
      setName("");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "INVALID_DATE"
          ? "Pick a valid date."
          : e.message === "NAME_REQUIRED"
            ? "Give the holiday a name."
            : e.message,
      ),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => setHolidayActive({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteHoliday({ data: { id } }),
    onSuccess: () => {
      toast.success("Holiday removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Attendance</p>
        <h1 className="mt-1 font-display text-4xl">Philippine Holidays</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Holidays are excluded from absence tracking and shown on the dashboard. Sync national
          holidays from the public calendar, and add proclaimed/movable ones (e.g. Eid) manually.
        </p>
      </div>

      {/* Sync + add */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <RefreshCw className="h-4 w-4" /> Sync from PH calendar
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Year</Label>
              <Input
                className="w-28"
                type="number"
                value={syncYear}
                onChange={(e) => setSyncYear(e.target.value)}
              />
            </div>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> {sync.isPending ? "Syncing…" : "Sync"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="h-4 w-4" /> Add a holiday
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                className="w-44"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[160px]">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                placeholder="e.g. Eid'l Fitr"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}>
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {isLoading ? "Loading…" : `${holidays?.length ?? 0} holidays`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Local name</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-center">Active</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.map((h) => (
                <tr key={h.id} className={`border-t ${h.is_active ? "" : "opacity-50"}`}>
                  <td className="whitespace-nowrap px-4 py-2">{formatDate(h.holiday_date)}</td>
                  <td className="px-4 py-2 font-medium">{h.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{h.local_name ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{h.source}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Switch
                      checked={h.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: h.id, isActive: v })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => remove.mutate(h.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (holidays?.length ?? 0) === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No holidays yet. Use “Sync” to pull this year's PH holidays.
            </div>
          )}
          <TablePagination
            page={pg.page}
            pageCount={pg.pageCount}
            pageSize={pg.pageSize}
            total={pg.total}
            start={pg.start}
            pageItemsCount={pg.pageItems.length}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
