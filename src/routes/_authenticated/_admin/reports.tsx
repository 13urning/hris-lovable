import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { generateActivityReport, type ReportRecordType } from "@/lib/report-functions";
import { triggerCSVDownload } from "@/lib/csv-export";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/reports")({
  component: ReportsPage,
});

const TYPE_OPTIONS: { value: ReportRecordType; label: string; hint: string }[] = [
  { value: "attendance", label: "Attendance", hint: "Daily time records, by work date" },
  { value: "leave", label: "Leave requests", hint: "By date the request was filed" },
  { value: "overtime", label: "OT requests", hint: "By date the request was filed" },
];

// Local YYYY-MM-DD (not toISOString, which would shift the date west of UTC).
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ReportsPage() {
  const today = new Date();
  const [startDate, setStartDate] = useState(
    localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [endDate, setEndDate] = useState(localDateStr(today));
  const [types, setTypes] = useState<Set<ReportRecordType>>(
    new Set(["attendance", "leave", "overtime"]),
  );

  const toggleType = (t: ReportRecordType, checked: boolean) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(t);
      else next.delete(t);
      return next;
    });
  };

  const generate = useMutation({
    mutationFn: () => generateActivityReport({ data: { startDate, endDate, types: [...types] } }),
    onSuccess: ({ csv, filename, counts }) => {
      triggerCSVDownload(csv, filename);
      toast.success(
        `Report downloaded — ${counts.attendance} attendance, ${counts.leave} leave, ${counts.overtime} OT rows`,
      );
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "INVALID_RANGE"
          ? "End date must be on or after the start date."
          : e.message === "RANGE_TOO_LARGE"
            ? "Pick a range of one year or less."
            : e.message === "NO_TYPES"
              ? "Select at least one record type."
              : e.message === "INVALID_DATE"
                ? "Enter valid start and end dates."
                : e.message,
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Reports</p>
        <h1 className="mt-1 font-display text-4xl">Data Export</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Export attendance, leave, and overtime records to a single CSV. Attendance rows are
          selected by work date; leave and OT rows by the date the request was filed (Philippine
          time). Use the record_type column to filter each dataset in a spreadsheet. Remarks appear
          in two columns — requester_remarks (the leave reason or OT justification) and
          approver_remarks (the reviewer&rsquo;s note).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-4 w-4" /> Generate a report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="report-start" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="report-start"
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-end" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="report-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Include</p>
            {TYPE_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <Checkbox
                  id={`report-type-${opt.value}`}
                  checked={types.has(opt.value)}
                  onCheckedChange={(v) => toggleType(opt.value, v === true)}
                />
                <Label htmlFor={`report-type-${opt.value}`} className="font-normal">
                  {opt.label}
                  <span className="ml-2 text-xs text-muted-foreground">{opt.hint}</span>
                </Label>
              </div>
            ))}
          </div>

          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || types.size === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {generate.isPending ? "Generating…" : "Generate & download CSV"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
