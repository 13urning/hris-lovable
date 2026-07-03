import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/calendar-functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, CalendarClock, CheckCheck, Clock3, Plane, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

// type → icon + deep-link. Icons match the nav (Plane = leaves, Timer = OT,
// Clock3 = attendance). route null = mark-read only (event reminders have no
// destination page). Requests and decisions share a route: each page already
// shows the approver queue and the requester's own history side by side.
const NOTIF_META: Record<string, { icon: typeof Bell; route: string | null }> = {
  event_reminder: { icon: CalendarClock, route: null },
  leave_request: { icon: Plane, route: "/leaves" },
  leave_decision: { icon: Plane, route: "/leaves" },
  ot_request: { icon: Timer, route: "/ot-approvals" },
  ot_decision: { icon: Timer, route: "/ot-approvals" },
  dispute_request: { icon: Clock3, route: "/dtr" },
  dispute_decision: { icon: Clock3, route: "/dtr" },
};

// Bell + unread badge for the app header. Polls the inbox once a minute while
// the tab is focused — the server materializes any due event reminders for the
// caller inside this same call; approval notifications are inserted eagerly by
// the leave/OT/dispute mutations and just show up on the next poll.
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getMyNotifications(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    // First-login users have no profile row yet (NO_PROFILE); stay silent
    // instead of retry-spamming — the next interval tick picks them up.
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead({ data: { id } }),
    onSuccess: invalidate,
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  const onItemClick = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.id);
    const route = NOTIF_META[n.type]?.route ?? null;
    if (route) {
      // Navigate optimistically — don't await the mark-read round-trip.
      setOpen(false);
      navigate({ to: route });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          )}
          {items.map((n: AppNotification) => {
            const Icon = NOTIF_META[n.type]?.icon ?? Bell;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                className={cn(
                  "block w-full border-b px-3 py-2.5 text-left last:border-b-0 transition-colors",
                  n.read_at ? "opacity-60" : "bg-secondary/40 hover:bg-secondary",
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      n.read_at ? "text-muted-foreground" : "text-primary",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
