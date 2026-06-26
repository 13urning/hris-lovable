import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Shared "reject with a reason" prompt for the various approval queues (leaves,
// attendance disputes, etc.). The reason is optional — confirming with an empty
// box rejects without a note. The reason is passed to onConfirm trimmed, or
// undefined when blank so the server keeps review_notes null.
export function RejectReasonDialog({
  open,
  onOpenChange,
  onConfirm,
  pending = false,
  title = "Reject request",
  description = "This rejection is final. Optionally tell the requester why.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | undefined) => void;
  pending?: boolean;
  title?: string;
  description?: string;
}) {
  const [reason, setReason] = useState("");

  // Start each open with a clean field so a prior reason never leaks across rows.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Rejection reason</Label>
          <Textarea
            id="reject-reason"
            rows={3}
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason.trim() || undefined)}
            disabled={pending}
          >
            Confirm rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
