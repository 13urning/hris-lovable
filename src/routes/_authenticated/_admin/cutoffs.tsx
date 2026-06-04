import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAllCutoffs } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/dtr";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/cutoffs")({ component: CutoffsPage });

function CutoffsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["cutoffs"], queryFn: getAllCutoffs });
  const [form, setForm] = useState({ cutoff_name: "", start_date: "", end_date: "", payout_date: "" });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payroll_cutoffs").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cut-off added"); qc.invalidateQueries({ queryKey: ["cutoffs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open"|"closed"|"paid" }) => {
      const { error } = await supabase.from("payroll_cutoffs").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cutoffs"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Payroll</p>
        <h1 className="mt-1 font-display text-4xl">Cut-off Periods</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Add cut-off</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label>Name</Label><Input value={form.cutoff_name} onChange={(e) => setForm({ ...form, cutoff_name: e.target.value })} /></div>
            <div><Label>Start</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>End</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            <div><Label>Payout</Label><Input type="date" value={form.payout_date} onChange={(e) => setForm({ ...form, payout_date: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => create.mutate()} disabled={!form.cutoff_name || !form.start_date || !form.end_date}>Add</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All cut-offs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Name</th><th className="px-4 py-2 text-left">Start</th><th className="px-4 py-2 text-left">End</th><th className="px-4 py-2 text-left">Payout</th><th className="px-4 py-2 text-left">Status</th></tr>
            </thead>
            <tbody>
              {data?.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">{c.cutoff_name}</td>
                  <td className="px-4 py-2">{formatDate(c.start_date)}</td>
                  <td className="px-4 py-2">{formatDate(c.end_date)}</td>
                  <td className="px-4 py-2">{formatDate(c.payout_date)}</td>
                  <td className="px-4 py-2">
                    <Select value={c.status} onValueChange={(v) => setStatus.mutate({ id: c.id, status: v as "open"|"closed"|"paid" })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
