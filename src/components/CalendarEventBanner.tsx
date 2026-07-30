import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, MapPin, X } from "lucide-react";
import {
  dismissAllEventBanners,
  getMyNotifications,
  markNotificationRead,
  type EventBanner,
} from "@/lib/calendar-functions";
import { Button } from "@/components/ui/button";

// Upcoming calendar events, shown as a banner at the top of the page instead of
// as notification-bell items. An event reminder is ambient context ("standup in
// 15 minutes") rather than something to open and action, so a bell item was the
// wrong shape: it competed with leave/OT/dispute approvals for the unread badge
// and had no destination to navigate to.
//
// Shares the ["notifications"] query key with NotificationBell, so both render
// from ONE poll — mounting this adds no network traffic. Dismissing marks the
// underlying notification read, which is what keeps it from coming back.
export function CalendarEventBanner() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getMyNotifications(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    // Matches the bell: first-login users have no profile row yet (NO_PROFILE),
    // so stay quiet rather than retry-spamming.
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const dismiss = useMutation({
    mutationFn: (id: string) => markNotificationRead({ data: { id } }),
    onSuccess: invalidate,
  });

  const dismissAll = useMutation({
    mutationFn: () => dismissAllEventBanners(),
    onSuccess: invalidate,
  });

  const events = data?.events ?? [];
  const hidden = data?.eventsHidden ?? 0;
  if (events.length === 0) return null;

  return (
    <section aria-label="Upcoming events" className="mb-6 space-y-2">
      {events.map((e: EventBanner) => (
        <div
          key={e.id}
          role="status"
          className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{e.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {e.body && <span>{e.body}</span>}
              {e.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {e.location}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Dismiss ${e.title}`}
            onClick={() => dismiss.mutate(e.id)}
            disabled={dismiss.isPending}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {(hidden > 0 || events.length > 1) && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            {hidden > 0 ? `+${hidden} more upcoming event${hidden === 1 ? "" : "s"}` : ""}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => dismissAll.mutate()}
            disabled={dismissAll.isPending}
          >
            Dismiss all
          </Button>
        </div>
      )}
    </section>
  );
}
