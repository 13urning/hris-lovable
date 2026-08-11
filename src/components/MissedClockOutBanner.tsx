import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { getMissedClockOut, selfReportClockOut } from "@/lib/dtr-functions";
import { formatDate, shiftDisplay } from "@/lib/dtr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConfirm } from "@/hooks/use-confirm";

// Friendlier wording for the server's rejection codes. The server is the
// authority on all of these — the input's own `max` is a convenience, not a
// guard, so a hand-crafted request still lands here.
const ERROR_COPY: Record<string, string> = {
  AFTER_SHIFT_END: "That's past the end of your shift. File an attendance dispute for extra hours.",
  BEFORE_CLOCK_IN: "Your clock-out has to be after the time you clocked in.",
  BAD_FORMAT: "Enter a valid time.",
  ALREADY_CLOCKED_OUT: "That day already has a clock-out.",
  DISPUTE_IN_FLIGHT: "There's already a correction under review for that day.",
  TOO_OLD: "That day is too far back to close yourself — file an attendance dispute.",
  DAY_NOT_OVER: "You can only do this for a day that's already finished.",
  NOT_CLOCKED_IN: "There's no clock-in recorded for that day.",
  NOT_FOUND: "That attendance record is no longer available.",
};

// Prompts the employee about the most recent day they clocked in but never
// clocked out, and lets them close it without an approver.
//
// The trade this makes: a forgotten tap used to cost a full attendance-dispute
// cycle, which is heavy for something this common. In exchange the time is
// capped at their shift end, so a self-report can never claim more than the day
// they were rostered for, and the row is tagged so HR can see which hours were
// declared rather than punched. Anything beyond the cap still goes to a human.
export function MissedClockOutBanner() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [timeOut, setTimeOut] = useState("");

  const { data: missed } = useQuery({
    queryKey: ["missed-clockout"],
    queryFn: () => getMissedClockOut(),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: (value: string) =>
      selfReportClockOut({ data: { dtrId: missed!.id, timeOut: value } }),
    onSuccess: (r) => {
      toast.success(`Clock-out saved for ${formatDate(r.workDate)}`);
      if (r.isUndertime) {
        toast.warning(`That day is short ${r.undertimeMins} min of a full day.`);
      }
      setTimeOut("");
      qc.invalidateQueries({ queryKey: ["missed-clockout"] });
      qc.invalidateQueries({ queryKey: ["recent-dtrs"] });
      qc.invalidateQueries({ queryKey: ["dtrs-month"] });
    },
    onError: (e: Error) => toast.error(ERROR_COPY[e.message] ?? e.message),
  });

  if (!missed) return null;

  const ask = () =>
    confirm.ask({
      title: "Save this clock-out?",
      description:
        "This closes the day without going through your approvers, so it's recorded as self-reported and visible to HR. If the time is wrong afterwards you'll need to file an attendance dispute.",
      details: (
        <>
          Date: <span className="text-foreground">{formatDate(missed.workDate)}</span>
          <br />
          Clocked in: <span className="tabular-nums text-foreground">{missed.timeIn}</span>
          <br />
          Clocking out: <span className="tabular-nums text-foreground">{timeOut}</span>
        </>
      ),
      confirmLabel: "Save clock-out",
      pendingLabel: "Saving…",
      onConfirm: () => submit.mutateAsync(timeOut),
    });

  return (
    <section aria-label="Missed clock-out" className="mb-6">
      <div
        role="status"
        className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 sm:flex-row sm:items-end"
      >
        <AlertTriangle className="mt-0.5 hidden h-4 w-4 shrink-0 text-warning-foreground sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            You didn&rsquo;t clock out on {formatDate(missed.workDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            Clocked in at <span className="tabular-nums">{missed.timeIn}</span> ·{" "}
            {shiftDisplay(missed.shiftLabel)}. Enter when you left — up to{" "}
            <span className="tabular-nums">{missed.capTimeOut}</span>. For anything later, file an
            attendance dispute.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="missed-clockout-time" className="text-xs text-muted-foreground">
              Clock-out
            </Label>
            <Input
              id="missed-clockout-time"
              type="time"
              className="h-9 w-32"
              value={timeOut}
              max={missed.capTimeOut}
              onChange={(e) => setTimeOut(e.target.value)}
            />
          </div>
          <Button onClick={ask} disabled={!timeOut || submit.isPending}>
            Save
          </Button>
        </div>
      </div>

      <ConfirmDialog {...confirm.dialogProps} />
    </section>
  );
}
