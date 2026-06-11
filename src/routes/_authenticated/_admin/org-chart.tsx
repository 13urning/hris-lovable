import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProfilesForOrg, fetchAllOrgNodes, saveOrgChartData } from "@/lib/org-functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export const Route = createFileRoute("/_authenticated/_admin/org-chart")({
  component: OrgChartPage,
});

// ── Inline types (org_nodes table not yet in types.ts) ──────────────────────
interface OrgNode {
  id: string;
  employee_id: string;
  parent_id: string | null;
  team_label: string | null;
  is_dept_head: boolean;
  position_x: number;
  position_y: number;
}

interface Profile {
  id: string;
  full_name: string;
  position: string | null;
  department: string | null;
}

// ── Custom node ──────────────────────────────────────────────────────────────
type EmployeeNodeData = {
  label: string;
  position?: string;
  team_label?: string;
  is_dept_head: boolean;
  employee_id: string;
};

function EmployeeNode({ data }: { data: EmployeeNodeData }) {
  return (
    <div
      className={`rounded-lg border bg-card px-4 py-3 shadow-sm min-w-[160px] text-center ${
        data.is_dept_head ? "border-primary ring-1 ring-primary/30" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} />
      {data.is_dept_head && (
        <div className="mb-1 text-[10px] uppercase tracking-widest text-primary font-semibold">
          Dept Head
        </div>
      )}
      <p className="font-semibold text-sm leading-tight">{data.label}</p>
      {data.position && (
        <p className="text-xs text-muted-foreground mt-0.5">{data.position}</p>
      )}
      {data.team_label && (
        <p className="mt-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
          {data.team_label}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { employee: EmployeeNode };

// ── Auto-layout ──────────────────────────────────────────────────────────────
// Lays the org tree out top-down with siblings spread horizontally. Stored
// position_x / position_y are ignored on render so the chart always shows a
// proper hierarchy (the user's complaint was that teams under one IS were
// stacking vertically because the saved coords had drifted). Stored coords are
// still written on save, so manual drags inside a session persist until the
// next reload.
const NODE_WIDTH = 200;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 140;

function computeAutoLayout(orgNodes: OrgNode[]): Record<string, { x: number; y: number }> {
  const idSet = new Set(orgNodes.map((n) => n.id));
  const children: Record<string, string[]> = {};
  for (const n of orgNodes) children[n.id] = [];
  for (const n of orgNodes) {
    if (n.parent_id && idSet.has(n.parent_id)) children[n.parent_id].push(n.id);
  }
  const roots = orgNodes
    .filter((n) => !n.parent_id || !idSet.has(n.parent_id))
    .map((n) => n.id);

  // Width = number of leaf descendants. Each leaf occupies one slot.
  const widthOf: Record<string, number> = {};
  function calcWidth(id: string, seen = new Set<string>()): number {
    if (id in widthOf) return widthOf[id];
    if (seen.has(id)) return 1; // cycle guard — shouldn't happen
    seen.add(id);
    const kids = children[id];
    if (!kids || kids.length === 0) { widthOf[id] = 1; return 1; }
    const w = kids.reduce((s, k) => s + calcWidth(k, seen), 0);
    widthOf[id] = Math.max(1, w);
    return widthOf[id];
  }
  for (const r of roots) calcWidth(r);

  const pos: Record<string, { x: number; y: number }> = {};
  function place(id: string, leftSlot: number, depth: number) {
    const w = widthOf[id] ?? 1;
    const centerSlot = leftSlot + w / 2;
    pos[id] = {
      x: (centerSlot - 0.5) * (NODE_WIDTH + HORIZONTAL_GAP),
      y: depth * VERTICAL_GAP,
    };
    let slot = leftSlot;
    for (const k of children[id] ?? []) {
      place(k, slot, depth + 1);
      slot += widthOf[k] ?? 1;
    }
  }
  let rootSlot = 0;
  for (const r of roots) {
    place(r, rootSlot, 0);
    rootSlot += widthOf[r] ?? 1;
  }
  return pos;
}

// ── Page ─────────────────────────────────────────────────────────────────────
function OrgChartPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sheet state (right panel for selected node)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [teamLabelDraft, setTeamLabelDraft] = useState("");
  const [isDeptHeadDraft, setIsDeptHeadDraft] = useState(false);

  // Add-employee dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // ── Remote data ─────────────────────────────────────────────────────────
  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ["profiles-org"],
    queryFn: () => fetchProfilesForOrg() as Promise<Profile[]>,
  });

  const { data: orgNodes = [], isLoading } = useQuery<OrgNode[]>({
    queryKey: ["org-nodes"],
    queryFn: () => fetchAllOrgNodes() as Promise<OrgNode[]>,
  });

  // ── Hydrate React Flow state once remote data is ready ──────────────────
  // Use a ref so this only ever runs once — if orgNodes refetches (e.g. after
  // a background token refresh causes a component remount), we do NOT reset
  // the canvas and lose unsaved work.
  const isHydrated = useRef(false);

  useEffect(() => {
    if (isHydrated.current) return;
    if (!orgNodes.length || !profiles.length) return;

    const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const layout = computeAutoLayout(orgNodes);

    const initialNodes: Node[] = orgNodes.map((on) => {
      const profile = profileMap[on.employee_id];
      const p = layout[on.id] ?? { x: on.position_x, y: on.position_y };
      return {
        id: on.id,
        type: "employee",
        position: p,
        data: {
          label: profile?.full_name ?? on.employee_id,
          position: profile?.position ?? undefined,
          team_label: on.team_label ?? undefined,
          is_dept_head: on.is_dept_head,
          employee_id: on.employee_id,
        } satisfies EmployeeNodeData,
      };
    });

    const initialEdges: Edge[] = orgNodes
      .filter((on) => on.parent_id !== null)
      .map((on) => ({
        id: `e-${on.id}`,
        source: on.parent_id as string,
        target: on.id,
        type: "smoothstep",
      }));

    setNodes(initialNodes);
    setEdges(initialEdges);
    isHydrated.current = true;
  }, [orgNodes, profiles, setNodes, setEdges]);

  // ── Unsaved-changes tracking ─────────────────────────────────────────────
  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Only mark dirty for meaningful changes (position, data) — not selection
      const hasMutation = changes.some(
        (c) => c.type === "position" || c.type === "remove"
      );
      if (hasMutation) markDirty();
    },
    [onNodesChange, markDirty]
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === "remove")) markDirty();
    },
    [onEdgesChange, markDirty]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds));
      markDirty();
    },
    [setEdges, markDirty]
  );

  // ── Node click → open sheet ──────────────────────────────────────────────
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    const d = node.data as EmployeeNodeData;
    setTeamLabelDraft(d.team_label ?? "");
    setIsDeptHeadDraft(d.is_dept_head);
    setSheetOpen(true);
  }, []);

  // ── Sheet: apply changes to node data ───────────────────────────────────
  const applyNodeDataChanges = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? {
              ...n,
              data: {
                ...(n.data as EmployeeNodeData),
                team_label: teamLabelDraft || undefined,
                is_dept_head: isDeptHeadDraft,
              },
            }
          : n
      )
    );
    markDirty();
  }, [selectedNode, teamLabelDraft, isDeptHeadDraft, setNodes, markDirty]);

  const removeNodeFromChart = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNode.id && e.target !== selectedNode.id
      )
    );
    setSheetOpen(false);
    setSelectedNode(null);
    markDirty();
  }, [selectedNode, setNodes, setEdges, markDirty]);

  // ── Add employee dialog ──────────────────────────────────────────────────
  const assignedEmployeeIds = new Set(
    nodes.map((n) => (n.data as EmployeeNodeData).employee_id)
  );

  const unassignedProfiles = profiles.filter(
    (p) => !assignedEmployeeIds.has(p.id)
  );

  const addEmployeeToChart = useCallback(
    (profile: Profile) => {
      const newNode: Node = {
        id: `new-${profile.id}-${Date.now()}`,
        type: "employee",
        position: {
          x: Math.random() * 400 + 50,
          y: Math.random() * 400 + 50,
        },
        data: {
          label: profile.full_name,
          position: profile.position ?? undefined,
          team_label: undefined,
          is_dept_head: false,
          employee_id: profile.id,
        } satisfies EmployeeNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
      setAddDialogOpen(false);
      markDirty();
    },
    [setNodes, markDirty]
  );

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const edgePairs = edges
        .map((edge) => {
          const childNode = nodes.find((n) => n.id === edge.target);
          const parentNode = nodes.find((n) => n.id === edge.source);
          if (!childNode || !parentNode) return null;
          return {
            childEmpId: (childNode.data as EmployeeNodeData).employee_id,
            parentEmpId: (parentNode.data as EmployeeNodeData).employee_id,
          };
        })
        .filter((p): p is { childEmpId: string; parentEmpId: string } => p !== null);

      await saveOrgChartData({
        data: {
          nodes: nodes.map((n) => {
            const d = n.data as EmployeeNodeData;
            return {
              employee_id: d.employee_id,
              team_label: d.team_label ?? null,
              is_dept_head: d.is_dept_head ?? false,
              position_x: n.position.x,
              position_y: n.position.y,
            };
          }),
          edgePairs,
        },
      });
      toast.success(nodes.length === 0 ? "Org chart cleared" : "Org chart saved");
      setHasUnsavedChanges(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [nodes, edges]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="font-display text-2xl text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 80px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Admin</p>
          <h1 className="font-display text-4xl">Org Chart</h1>
        </div>
        <div className="flex items-center gap-3">
          {hasUnsavedChanges && (
            <span className="text-xs text-warning-foreground">Unsaved changes</span>
          )}
          <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
            Add Employee
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Chart"}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 rounded-lg border overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode="Delete"
        >
          <Background />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </div>

      {/* Empty state overlay */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-24">
          <p className="text-muted-foreground text-sm">No employees on the chart yet.</p>
          <p className="text-muted-foreground text-xs mt-1">
            Click &ldquo;Add Employee&rdquo; to place someone on the canvas.
          </p>
        </div>
      )}

      {/* Right-panel sheet (node editor) */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) {
            applyNodeDataChanges();
            setSheetOpen(false);
          }
        }}
      >
        <SheetContent className="w-80">
          <SheetHeader>
            <SheetTitle>
              {selectedNode
                ? (selectedNode.data as EmployeeNodeData).label
                : "Employee"}
            </SheetTitle>
          </SheetHeader>

          {selectedNode && (
            <div className="mt-6 space-y-5 px-1">
              {/* Position (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Position
                </Label>
                <p className="text-sm">
                  {(selectedNode.data as EmployeeNodeData).position ?? (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </p>
              </div>

              {/* Team label */}
              <div className="space-y-1.5">
                <Label htmlFor="team-label">Team label</Label>
                <Input
                  id="team-label"
                  value={teamLabelDraft}
                  onChange={(e) => setTeamLabelDraft(e.target.value)}
                  placeholder="e.g. Backend, Platform, QA"
                />
              </div>

              {/* Dept head toggle */}
              <div className="flex items-center gap-3">
                <Switch
                  id="dept-head"
                  checked={isDeptHeadDraft}
                  onCheckedChange={setIsDeptHeadDraft}
                />
                <Label htmlFor="dept-head">Mark as Department Head</Label>
              </div>

              {/* Apply + Remove */}
              <div className="pt-2 space-y-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    applyNodeDataChanges();
                    setSheetOpen(false);
                  }}
                >
                  Apply changes
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={removeNodeFromChart}
                >
                  Remove from chart
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Employee dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Employee to Chart</DialogTitle>
          </DialogHeader>

          {unassignedProfiles.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              All employees are already on the chart.
            </p>
          ) : (
            <ul className="mt-2 max-h-80 overflow-y-auto divide-y">
              {unassignedProfiles.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => addEmployeeToChart(p)}
                    className="w-full px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors"
                  >
                    <p className="text-sm font-medium">{p.full_name}</p>
                    {(p.position || p.department) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[p.position, p.department].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
