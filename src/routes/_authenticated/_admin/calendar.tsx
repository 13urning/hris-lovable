import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  listCalendarEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  addReminder,
  deleteReminder,
  fetchProfilesForEventPicker,
  type CalendarEvent,
} from "@/lib/calendar-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TablePagination } from "@/components/TablePagination";
import { usePagination } from "@/hooks/use-pagination";
import { BellRing, CalendarClock, Pencil, Plus, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/calendar")({
  component: CalendarPage,
});

const OFFSETS = [
  { value: 0, label: "At event time" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
  { value: 4320, label: "3 days before" },
  { value: 10080, label: "1 week before" },
  { value: 20160, label: "2 weeks before" },
];

function offsetLabel(minutes: number) {
  return OFFSETS.find((o) => o.value === minutes)?.label ?? `${minutes} min before`;
}

// All rendering is pinned to PH time regardless of the browser's zone, matching
// how the server interprets event input.
function formatWhen(e: CalendarEvent) {
  const d = new Date(e.starts_at);
  const dateStr = d.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (e.all_day) return dateStr;
  const timeStr = d.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr}, ${timeStr}`;
}

// timestamptz ISO → PH-local date/time input values (for the edit form).
function phDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return { date, time };
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "Check the form fields and try again.",
  INVALID_DATE: "Pick a valid date and time.",
  END_BEFORE_START: "The end must be after the start.",
  INVALID_RECIPIENT: "Pick a valid reminder recipient.",
  REMINDER_LIMIT: "An event can have at most 10 reminders.",
  NOT_FOUND: "That record no longer exists — it may have been deleted.",
  FORBIDDEN: "Only admins can manage calendar events.",
  INTERNAL_ERROR: "Something went wrong. Try again.",
};

function friendlyError(e: Error) {
  return ERROR_MESSAGES[e.message] ?? e.message;
}

type EventForm = {
  id?: string;
  title: string;
  description: string;
  location: string;
  date: string;
  time: string;
  allDay: boolean;
};

type PendingReminder = { notifyUserId?: string; offsetMinutes: number };

const emptyForm: EventForm = {
  title: "",
  description: "",
  location: "",
  date: "",
  time: "09:00",
  allDay: false,
};

function CalendarPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EventForm>(emptyForm);
  // Reminders staged in the create dialog (saved with the event in one call).
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([]);
  // Reminder-row inputs, shared by create (staged) and edit (immediate) modes.
  const [remRecipient, setRemRecipient] = useState("me");
  const [remOffset, setRemOffset] = useState("1440");

  const isEditing = !!form.id;

  const { data: events, isLoading } = useQuery({
    queryKey: ["calendar-events"],
    queryFn: () => listCalendarEvents() as Promise<CalendarEvent[]>,
  });

  const { data: people } = useQuery({
    queryKey: ["event-picker-profiles"],
    queryFn: () => fetchProfilesForEventPicker(),
    enabled: isAdmin,
  });

  const pg = usePagination(events ?? [], 25);
  const editingEvent = isEditing ? events?.find((e) => e.id === form.id) : undefined;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["calendar-events"] });

  const openCreate = () => {
    setForm(emptyForm);
    setPendingReminders([{ offsetMinutes: 1440 }]); // sensible default: remind me 1 day before
    setRemRecipient("me");
    setRemOffset("1440");
    setDialogOpen(true);
  };

  const openEdit = (e: CalendarEvent) => {
    const { date, time } = phDateParts(e.starts_at);
    setForm({
      id: e.id,
      title: e.title,
      description: e.description ?? "",
      location: e.location ?? "",
      date,
      time,
      allDay: e.all_day,
    });
    setRemRecipient("me");
    setRemOffset("1440");
    setDialogOpen(true);
  };

  const eventPayload = () => ({
    title: form.title,
    description: form.description.trim() || undefined,
    location: form.location.trim() || undefined,
    date: form.date,
    time: form.allDay ? undefined : form.time || undefined,
    allDay: form.allDay,
  });

  const create = useMutation({
    mutationFn: () => createEvent({ data: { ...eventPayload(), reminders: pendingReminders } }),
    onSuccess: () => {
      toast.success("Event created");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const update = useMutation({
    mutationFn: () => updateEvent({ data: { ...eventPayload(), id: form.id! } }),
    onSuccess: () => {
      toast.success("Event updated");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEvent({ data: { id } }),
    onSuccess: () => {
      toast.success("Event deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const addRem = useMutation({
    mutationFn: (v: { eventId: string; notifyUserId?: string; offsetMinutes: number }) =>
      addReminder({ data: v }),
    onSuccess: () => {
      toast.success("Reminder added");
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const removeRem = useMutation({
    mutationFn: (id: string) => deleteReminder({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const personName = (id: string | undefined) =>
    id ? (people?.find((p) => p.id === id)?.full_name ?? "Selected user") : "Me";

  const stageReminder = () => {
    setPendingReminders((prev) => [
      ...prev,
      {
        notifyUserId: remRecipient === "me" ? undefined : remRecipient,
        offsetMinutes: Number(remOffset),
      },
    ]);
  };

  const reminderRecipientSelect = (
    <Select value={remRecipient} onValueChange={setRemRecipient}>
      <SelectTrigger className="w-full sm:w-48">
        <SelectValue placeholder="Notify..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="me">Me</SelectItem>
        {people?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.full_name}
            {p.department ? ` (${p.department})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const reminderOffsetSelect = (
    <Select value={remOffset} onValueChange={setRemOffset}>
      <SelectTrigger className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OFFSETS.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Organization</p>
          <h1 className="mt-1 font-display text-4xl">Calendar Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Schedule events and attach reminders that notify you or a chosen employee in-app when
            the time comes. Event titles and details are visible to all signed-in users — keep
            sensitive specifics out of them.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> New event
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            {isLoading ? "Loading…" : `${events?.length ?? 0} events`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Event</th>
                <th className="px-4 py-2 text-left">Location</th>
                <th className="px-4 py-2 text-left">Reminders</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.map((e) => {
                const past = new Date(e.starts_at).getTime() < Date.now();
                return (
                  <tr key={e.id} className={`border-t align-top ${past ? "opacity-50" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-2">{formatWhen(e)}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{e.title}</p>
                      {e.description && (
                        <p className="text-xs text-muted-foreground">{e.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{e.location ?? "—"}</td>
                    <td className="px-4 py-2">
                      {e.reminders.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {e.reminders.map((r) => (
                            <span
                              key={r.id}
                              className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
                            >
                              <BellRing className="h-3 w-3" />
                              {r.notify_user_name ?? "—"} · {offsetLabel(r.offset_minutes)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => remove.mutate(e.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isLoading && (events?.length ?? 0) === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No events yet.{isAdmin ? " Create one with “New event”." : ""}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>
              Times are Philippine time. A reminder that lands in the past fires on the recipient's
              next visit.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input
                value={form.title}
                maxLength={200}
                placeholder="e.g. Performance review — Q3"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Description (optional)</Label>
              <Textarea
                value={form.description}
                maxLength={2000}
                rows={2}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input
                  className="w-40"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              {!form.allDay && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Time</Label>
                  <Input
                    className="w-28"
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
              )}
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  checked={form.allDay}
                  onCheckedChange={(v) => setForm({ ...form, allDay: v })}
                />
                <Label className="text-xs text-muted-foreground">All day</Label>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Location (optional)</Label>
              <Input
                value={form.location}
                maxLength={200}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>

            {/* Reminders */}
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reminders
              </p>

              {!isEditing && (
                <>
                  {pendingReminders.length === 0 && (
                    <p className="text-xs text-muted-foreground">No reminders.</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {pendingReminders.map((r, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
                      >
                        <BellRing className="h-3 w-3" />
                        {personName(r.notifyUserId)} · {offsetLabel(r.offsetMinutes)}
                        <button
                          type="button"
                          aria-label="Remove reminder"
                          onClick={() =>
                            setPendingReminders((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {reminderRecipientSelect}
                    {reminderOffsetSelect}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="sm:self-center"
                      disabled={pendingReminders.length >= 10}
                      onClick={stageReminder}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </>
              )}

              {isEditing && (
                <>
                  {(editingEvent?.reminders ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No reminders.</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {editingEvent?.reminders.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
                      >
                        <BellRing className="h-3 w-3" />
                        {r.notify_user_name ?? "—"} · {offsetLabel(r.offset_minutes)}
                        <button
                          type="button"
                          aria-label="Remove reminder"
                          onClick={() => removeRem.mutate(r.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {reminderRecipientSelect}
                    {reminderOffsetSelect}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="sm:self-center"
                      disabled={addRem.isPending || (editingEvent?.reminders.length ?? 0) >= 10}
                      onClick={() =>
                        addRem.mutate({
                          eventId: form.id!,
                          notifyUserId: remRecipient === "me" ? undefined : remRecipient,
                          offsetMinutes: Number(remOffset),
                        })
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.title.trim() || !form.date || create.isPending || update.isPending}
              onClick={() => (isEditing ? update.mutate() : create.mutate())}
            >
              {isEditing ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
