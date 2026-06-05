import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/employees")({ component: EmployeesPage });

type Row = {
  id: string; full_name: string; email: string | null; department: string;
  employee_code: string | null; position: string | null; company: string | null;
  vl_credits: number | null; sl_credits: number | null;
  roles: ("employee"|"hr"|"admin")[];
};

function EmployeesPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Row[]> => {
      const { data: profiles, error } = await supabase.from("profiles").select("*").order("full_name");
      if (error) throw error;
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Row["roles"][number]),
      }));
    },
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: "full_name"|"department"|"employee_code"|"position"|"company"|"vl_credits"|"sl_credits"; value: string | number }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: value } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "employee"|"hr"|"admin" }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const inserts = role === "admin"
        ? [{ user_id: userId, role: "admin" as const }, { user_id: userId, role: "hr" as const }, { user_id: userId, role: "employee" as const }]
        : role === "hr"
        ? [{ user_id: userId, role: "hr" as const }, { user_id: userId, role: "employee" as const }]
        : [{ user_id: userId, role: "employee" as const }];
      const { error } = await supabase.from("user_roles").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (data ?? []).filter((r) =>
    !search || r.full_name.toLowerCase().includes(search.toLowerCase())
    || (r.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">People</p>
        <h1 className="mt-1 font-display text-4xl">Employees</h1>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{filtered.length} {filtered.length === 1 ? "person" : "people"}</CardTitle>
          <Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">VL Credits</th>
                <th className="px-3 py-2 text-left">SL Credits</th>
                <th className="px-3 py-2 text-left">Role</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const role: "employee"|"hr"|"admin" =
                  r.roles.includes("admin") ? "admin" : r.roles.includes("hr") ? "hr" : "employee";
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">
                      <Input defaultValue={r.full_name} className="h-8" onBlur={(e) => e.target.value !== r.full_name &&
                        updateProfile.mutate({ id: r.id, field: "full_name", value: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.email}</td>
                    <td className="px-3 py-2">
                      <Input defaultValue={r.employee_code ?? ""} className="h-8 w-28" onBlur={(e) => e.target.value !== (r.employee_code ?? "") &&
                        updateProfile.mutate({ id: r.id, field: "employee_code", value: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input defaultValue={r.company ?? ""} className="h-8" placeholder="—"
                        onBlur={(e) => e.target.value !== (r.company ?? "") &&
                          updateProfile.mutate({ id: r.id, field: "company", value: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input defaultValue={r.department} className="h-8" onBlur={(e) => e.target.value !== r.department &&
                        updateProfile.mutate({ id: r.id, field: "department", value: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input defaultValue={r.position ?? ""} className="h-8" onBlur={(e) => e.target.value !== (r.position ?? "") &&
                        updateProfile.mutate({ id: r.id, field: "position", value: e.target.value })} />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        defaultValue={r.vl_credits ?? 10}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none"
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v !== (r.vl_credits ?? 10)) {
                            updateProfile.mutate({ id: r.id, field: "vl_credits", value: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        defaultValue={r.sl_credits ?? 10}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none"
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v !== (r.sl_credits ?? 10)) {
                            updateProfile.mutate({ id: r.id, field: "sl_credits", value: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={role} disabled={!isAdmin}
                        onValueChange={(v) => setRole.mutate({ userId: r.id, role: v as "employee"|"hr"|"admin" })}>
                        <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="hr">HR</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {!isAdmin && <p className="text-xs text-muted-foreground">Only admins can change roles.</p>}
    </div>
  );
}
