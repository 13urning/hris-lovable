import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHIFT_OPTIONS, todayIso } from "@/lib/dtr";
import { fetchDtrForDispute, fileAttendanceDispute } from "@/lib/attendance-dispute-functions";
import { toast } from "sonner";

const ERROR_LABELS: Record<string, string> = {
  TIME_IN_REQUIRED: "Enter a clock-in time.",
  TIME_OUT_BEFORE_IN: "Clock-out must be after clock-in.",
  NO_ORG_NODE: "You're not in the org chart yet, so this can't be routed for approval. Ask HR.",
};

export function DisputeAttendanceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [form, setForm] = useState({ timeIn: "", timeOut: "", shift: "", reason: "" });

  // Pull the existing record for the chosen date so the employee edits real
  // values instead of typing them blind. Re-runs whenever the date changes.
  const { data: dtr, isFetching } = useQuery({
    queryKey: ["dispute-dtr", date],
    enabled: open && !!date,
    queryFn: () => fetchDtrForDispute({ data: { date } }),
  });

  // Prefill the form from whatever the date returned (blank for an absent day).
  useEffect(() => {
    setForm({
      timeIn: dtr?.time_in?.slice(0, 5) ?? "",
      timeOut: dtr?.time_out?.slice(0, 5) ?? "",
      shift: dtr?.shift_label ?? "",
      reason: "",
    });
  }, [dtr]);

  // Reset to today each time the dialog opens.
  useEffect(() => {
    if (open) setDate(today);
  }, [open, today]);

  const file = useMutation({
    mutationFn: async () => {
      if (!form.timeIn) throw new Error("TIME_IN_REQUIRED");
      await fileAttendanceDispute({
        data: {
          workDate: date,
          timeIn: form.timeIn,
          timeOut: form.timeOut || null,
          shiftLabel: form.shift || null,
          reason: form.reason || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Dispute submitted for approval");
      qc.invalidateQueries({ queryKey: ["my-disputes"] });
      qc.invalidateQueries({ queryKey: ["dtrs-month"] });
      qc.invalidateQueries({ queryKey: ["disputes-pending-for-me"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(ERROR_LABELS[e.message] ?? e.message),
  });

  const hadRecord = !!dtr;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispute attendance</DialogTitle>
          <DialogDescription>
            Pick a date, correct the recorded times, and submit. Your request is routed up your
            org-chart approval line before it takes effect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isFetching
                ? "Loading record…"
                : hadRecord
                  ? "Found a record for this date — edit the values below."
                  : "No record on this date — entering times will add attendance for the day."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Clock in</Label>
              <Input
                type="time"
                value={form.timeIn}
                onChange={(e) => setForm({ ...form, timeIn: e.target.value })}
              />
            </div>
            <div>
              <Label>Clock out</Label>
              <Input
                type="time"
                value={form.timeOut}
                onChange={(e) => setForm({ ...form, timeOut: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>Shift</Label>
            <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select shift" />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Reason</Label>
            <Textarea
              rows={2}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Explain why the recorded attendance is wrong"
            />
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => file.mutate()} disabled={file.isPending || !form.timeIn}>
            Submit dispute
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
