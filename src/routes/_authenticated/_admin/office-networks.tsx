import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listOfficeNetworks,
  addOfficeNetwork,
  setOfficeNetworkActive,
  deleteOfficeNetwork,
  getMyCurrentIp,
  type OfficeNetwork,
} from "@/lib/office-network-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Trash2, MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/office-networks")({
  component: OfficeNetworksPage,
});

function OfficeNetworksPage() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [cidr, setCidr] = useState("");

  const { data: networks, isLoading } = useQuery({
    queryKey: ["office-networks"],
    queryFn: () => listOfficeNetworks() as Promise<OfficeNetwork[]>,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["office-networks"] });

  const add = useMutation({
    mutationFn: () => addOfficeNetwork({ data: { label, cidr } }),
    onSuccess: () => {
      toast.success("Network added");
      setLabel("");
      setCidr("");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "INVALID_CIDR"
          ? "That's not a valid IP or CIDR (e.g. 203.0.113.10 or 203.0.113.0/24)."
          : e.message === "LABEL_REQUIRED"
            ? "Give the network a label."
            : e.message === "CIDR_REQUIRED"
              ? "Enter an IP or CIDR range."
              : e.message,
      ),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => setOfficeNetworkActive({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteOfficeNetwork({ data: { id } }),
    onSuccess: () => {
      toast.success("Network removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fillMyIp = useMutation({
    mutationFn: () => getMyCurrentIp(),
    onSuccess: ({ ip }) => {
      if (!ip) {
        toast.error("Couldn't detect your IP.");
        return;
      }
      setCidr(ip);
      if (!label) setLabel("My current network");
      toast.success(`Your current IP: ${ip}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeCount = (networks ?? []).filter((n) => n.is_active).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Security</p>
        <h1 className="mt-1 font-display text-4xl">Office Networks</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Clock-in is only allowed from these networks. While the list is empty the restriction is
          off and employees can clock in from anywhere — add at least one active network to switch
          it on.
        </p>
      </div>

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-4 w-4" /> Add a network
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grow space-y-1">
              <Label className="text-xs text-muted-foreground">Label</Label>
              <Input
                placeholder="e.g. Main office WiFi"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="grow space-y-1">
              <Label className="text-xs text-muted-foreground">IP or CIDR range</Label>
              <Input
                placeholder="203.0.113.10 or 203.0.113.0/24"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => fillMyIp.mutate()}
              disabled={fillMyIp.isPending}
            >
              <MapPin className="mr-2 h-4 w-4" /> Use my current IP
            </Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>
              Add
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A single IP is treated as a /32. Use a CIDR (e.g. <code>/24</code>) to allow a whole
            range if your ISP gives you a block.
          </p>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {isLoading
              ? "Loading…"
              : `${networks?.length ?? 0} network${(networks?.length ?? 0) === 1 ? "" : "s"} · ${activeCount} active`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Label</th>
                <th className="px-4 py-2 text-left">Range</th>
                <th className="px-4 py-2 text-left">Active</th>
                <th className="px-4 py-2 text-right">Remove</th>
              </tr>
            </thead>
            <tbody>
              {(networks ?? []).map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{n.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{n.cidr}</td>
                  <td className="px-4 py-2">
                    <Switch
                      checked={n.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: n.id, isActive: v })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove.mutate(n.id)}
                      aria-label="Remove network"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (networks?.length ?? 0) === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No networks configured — clock-in is currently unrestricted.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
