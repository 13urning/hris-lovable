import { useCallback, useMemo, useState } from "react";

import type { ConfirmRequest } from "@/components/ConfirmDialog";

// One confirmation dialog per screen, driven by whichever action asked for it.
// Render <ConfirmDialog {...confirm.dialogProps} /> once, then call
// confirm.ask({...}) from every create / update / delete trigger on the page.
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);

  return useMemo(
    () => ({
      ask: (next: ConfirmRequest) => setRequest(next),
      dialogProps: { request, onClose: close },
    }),
    [request, close],
  );
}
