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
// cycle, which is heavy for something this common. Any time after the clock-in
// is accepted, including one past the end of the rostered shift — the dialog
// says so plainly when that happens, and the row is tagged either way, so what
// HR reviews is the self-reported flag rather than a blocked submission.
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

  // Nothing stops a time past the rostered shift end, but the employee is told
  // that is what they are claiming before it is written.
  const pastShiftEnd = !!timeOut && timeOut > missed.shiftEnd;

  const ask = () =>
    confirm.ask({
      title: "Save this clock-out?",
      description: pastShiftEnd
        ? "This closes the day without going through your approvers, so it's recorded as self-reported and visible to HR. You're claiming time past the end of your shift, so make sure it's right — correcting it afterwards means filing an attendance dispute."
        : "This closes the day without going through your approvers, so it's recorded as self-reported and visible to HR. If the time is wrong afterwards you'll need to file an attendance dispute.",
      details: (
        <>
          Date: <span className="text-foreground">{formatDate(missed.workDate)}</span>
          <br />
          Clocked in: <span className="tabular-nums text-foreground">{missed.timeIn}</span>
          <br />
          Clocking out: <span className="tabular-nums text-foreground">{timeOut}</span>
          {pastShiftEnd && (
            <>
              <br />
              Shift ends: <span className="tabular-nums text-foreground">{missed.shiftEnd}</span> —
              you&rsquo;re claiming past it
            </>
          )}
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
            {shiftDisplay(missed.shiftLabel)}. Enter when you actually left.
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
