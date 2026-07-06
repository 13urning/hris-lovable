import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getMyWhatsNew, dismissWhatsNew } from "@/lib/whats-new-functions";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-06" → "Jul 6, 2026". Parsed by hand from the date-only string so no
// timezone shift creeps in (new Date("2026-07-06") would be UTC midnight).
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

// Shown on login after the password-change gate (mounted in AppShell). Fetches
// the caller's unseen, role-matched, major announcements; if any, opens a modal
// once. Dismissing (button, X, Esc, or backdrop) marks them seen server-side so
// it never re-nags — on this device or any other.
export function WhatsNewModal() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Local latch: close instantly on dismiss without waiting for the mark-seen
  // round-trip + refetch, so the modal can't flicker back open.
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["whats-new"],
    queryFn: () => getMyWhatsNew(),
    enabled: !!user,
    staleTime: Infinity,
    retry: false, // first-login users may 404 (NO_PROFILE); stay silent, don't spam
    refetchOnWindowFocus: false,
  });

  const dismiss = useMutation({
    mutationFn: () => dismissWhatsNew(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["whats-new"] }),
  });

  const entries = data?.entries ?? [];
  if (entries.length === 0) return null;

  const close = () => {
    setDismissed(true);
    dismiss.mutate();
  };

  return (
    <Dialog
      open={!dismissed}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="font-display text-2xl">What’s New</DialogTitle>
          </div>
          <DialogDescription>New features and updates for your role.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {entries.map((e) => (
            <div key={e.id} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium leading-tight">{e.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(e.publishedAt)}
                </span>
              </div>
              <ul className="space-y-1.5">
                {e.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={close}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
