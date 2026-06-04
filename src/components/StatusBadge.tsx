import { STATUS_LABEL, STATUS_TONE, type ApprovalStatus } from "@/lib/dtr";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: ApprovalStatus; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
      STATUS_TONE[status], className,
    )}>
      {STATUS_LABEL[status]}
    </span>
  );
}
