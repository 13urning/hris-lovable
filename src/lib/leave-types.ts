// Shared leave-type catalog: the value stored in `leave_requests.leave_type`
// paired with its display label. Used by the leave filing UI (leaves.tsx) and
// the admin "All Requests" page (all-requests.tsx) so both render identical
// labels for the same stored code.
export type LeaveTypeOption = { value: string; label: string };

export const LEAVE_TYPES: LeaveTypeOption[] = [
  { value: "VL", label: "Vacation Leave" },
  { value: "SL", label: "Sick Leave" },
  { value: "EL", label: "Emergency Leave" },
  { value: "BDAY", label: "Birthday Leave" },
  { value: "ML", label: "Maternity Leave" },
  { value: "PL", label: "Paternity Leave" },
  { value: "BL", label: "Bereavement Leave" },
  { value: "WP", label: "Leave without Pay" },
  { value: "Other", label: "Other" },
];

// Label for a stored leave-type code, falling back to the raw code if it's
// ever missing from the catalog (never guessing a friendlier string).
export function leaveTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LEAVE_TYPES.find((t) => t.value === value)?.label ?? value;
}
