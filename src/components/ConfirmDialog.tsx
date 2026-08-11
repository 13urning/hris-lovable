import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A single confirmation step for a create / update / delete action.
 *
 * The shape mirrors the "Delete employee?" dialog on the Employees screen, which
 * is the house style for confirmations: a question as the title, one sentence of
 * plain-language consequences, an optional muted box repeating the identifying
 * details of the record, and an outline Cancel next to the committing button.
 */
export type ConfirmRequest = {
  /** Phrased as a question — "Delete this holiday?" */
  title: string;
  /** What happens, and whether it can be undone. */
  description: React.ReactNode;
  /** Optional muted box echoing which record this is about. */
  details?: React.ReactNode;
  /** Verb for the committing button — "Delete permanently", "Approve". */
  confirmLabel?: string;
  /** Shown while the mutation is in flight — "Deleting…". */
  pendingLabel?: string;
  cancelLabel?: string;
  /** Renders the committing button in the destructive variant. */
  destructive?: boolean;
  onConfirm: () => void | Promise<unknown>;
};

type ConfirmDialogProps = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);

  // Keep the last request around so the content does not blank out mid-close.
  const [shown, setShown] = React.useState<ConfirmRequest | null>(request);
  React.useEffect(() => {
    if (request) setShown(request);
  }, [request]);

  const run = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await request.onConfirm();
    } catch {
      // The mutation's own onError surfaces the toast; just release the dialog.
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const active = request ?? shown;

  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{active?.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm">{active?.description}</p>
          {active?.details && (
            <div className="rounded-md border bg-secondary/30 p-3 text-xs text-muted-foreground">
              {active.details}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {active?.cancelLabel ?? "Cancel"}
          </Button>
          {/* Keyed so a destructive confirm following a normal one (or vice versa)
              mounts a fresh button instead of letting transition-colors animate
              the old colour across while the dialog is fading in. */}
          <Button
            key={active?.destructive ? "destructive" : "default"}
            variant={active?.destructive ? "destructive" : "default"}
            onClick={run}
            disabled={busy}
          >
            {busy ? (active?.pendingLabel ?? "Working…") : (active?.confirmLabel ?? "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
