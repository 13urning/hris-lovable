import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Count working days (Mon–Fri) between two ISO date strings, inclusive. */
export function businessDaysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const start = new Date(a);
  const end = new Date(b);
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}
