"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { CycleCountTaskDetail } from "@/components/warehouse-ops/cycle-count-task-detail";
import { resolveScan, findBinByPath } from "@/lib/warehouse-putaway";
import {
  cancelCycleCountTask,
  CYCLE_COUNT_VARIANCE_REASONS,
  createSpotCountTask,
  defaultCountedLines,
  listActiveWarehouseBins,
  loadActiveCycleCountTasks,
  loadRecentCycleCountTasks,
  resolveTaskBinScan,
  startQuickBinCount,
  submitBinCycleCount,
  buildExpectedLinesForBin,
} from "@/lib/warehouse-cycle-count";
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import type {
  WarehouseBinDoc,
  WarehouseCycleCountCountedLine,
  WarehouseCycleCountTaskDoc,
  WarehouseDoc,
} from "@/types";
import Link from "next/link";
import { hasRole } from "@/lib/permissions";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  ScanLine,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

type CountPhase = "home" | "bin-scan" | "counting";
type CountMode = "quick" | "assigned";

export function WarehouseOpsCycleCount({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const canManageTasks = isOpsSupervisor(userProfile);
  const canOpenAdminReports =
    hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");

  const [tasks, setTasks] = useState<WarehouseCycleCountTaskDoc[]>([]);
  const [recentTasks, setRecentTasks] = useState<WarehouseCycleCountTaskDoc[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedTask, setSelectedTask] = useState<WarehouseCycleCountTaskDoc | null>(null);
  const [viewingTask, setViewingTask] = useState<WarehouseCycleCountTaskDoc | null>(null);
  const [countMode, setCountMode] = useState<CountMode>("quick");
  const [phase, setPhase] = useState<CountPhase>("home");

  const [binScan, setBinScan] = useState("");
  const [cartonScan, setCartonScan] = useState("");
  const [activeBinId, setActiveBinId] = useState<string | null>(null);
  const [activeBinPath, setActiveBinPath] = useState<string | null>(null);
  const [expectedCartons, setExpectedCartons] = useState<Array<{ id: string; code: string }>>([]);
  const [scannedCartonIds, setScannedCartonIds] = useState<string[]>([]);
  const [scannedCartonCodes, setScannedCartonCodes] = useState<string[]>([]);
  const [countedLines, setCountedLines] = useState<WarehouseCycleCountCountedLine[]>([]);
  const [countNotes, setCountNotes] = useState("");
  const [resolvingBin, setResolvingBin] = useState(false);
  const [resolvingCarton, setResolvingCarton] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [createRandomCount, setCreateRandomCount] = useState("3");
  const [createTitle, setCreateTitle] = useState("");
  const [createBinScan, setCreateBinScan] = useState("");
  const [createBinPaths, setCreateBinPaths] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [warehouseBins, setWarehouseBins] = useState<WarehouseBinDoc[]>([]);
  const [binPickerLoading, setBinPickerLoading] = useState(false);
  const [binPickerQuery, setBinPickerQuery] = useState("");
  const [addingBin, setAddingBin] = useState(false);

  const binInputRef = useRef<HTMLInputElement | null>(null);
  const cartonInputRef = useRef<HTMLInputElement | null>(null);
  const createBinInputRef = useRef<HTMLInputElement | null>(null);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const [active, recent] = await Promise.all([
        loadActiveCycleCountTasks(warehouse.id),
        canManageTasks ? loadRecentCycleCountTasks(warehouse.id, 15) : Promise.resolve([]),
      ]);
      setTasks(active);
      setRecentTasks(recent);
    } catch (e) {
      toast({
        title: "Could not load count tasks",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingTasks(false);
    }
  }, [warehouse.id, canManageTasks, toast]);

  useEffect(() => {
    if (phase === "home") {
      setTimeout(() => binInputRef.current?.focus(), 50);
    }
  }, [phase]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const pendingBins = useMemo(() => {
    if (!selectedTask) return [];
    return selectedTask.binIds
      .map((id, i) => ({
        id,
        path: selectedTask.binPaths[i] ?? id,
        done: selectedTask.completedBinIds.includes(id),
      }))
      .filter((b) => !b.done);
  }, [selectedTask]);

  const assignedTasks = useMemo(
    () => tasks.filter((t) => t.type !== "quick"),
    [tasks]
  );

  const filteredPickerBins = useMemo(() => {
    const q = binPickerQuery.trim().toUpperCase();
    const available = warehouseBins.filter((b) => !createBinPaths.includes(b.path));
    if (!q) return available.slice(0, 40);
    return available
      .filter(
        (b) =>
          b.path.toUpperCase().includes(q) ||
          b.barcode.toUpperCase().includes(q) ||
          b.area.toUpperCase().includes(q)
      )
      .slice(0, 40);
  }, [warehouseBins, binPickerQuery, createBinPaths]);

  async function ensureWarehouseBinsLoaded() {
    if (warehouseBins.length > 0 || binPickerLoading) return;
    setBinPickerLoading(true);
    try {
      setWarehouseBins(await listActiveWarehouseBins(warehouse.id));
    } catch (e) {
      toast({
        title: "Could not load bins",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBinPickerLoading(false);
    }
  }

  function addBinToList(path: string) {
    if (createBinPaths.includes(path)) {
      toast({ title: "Bin already on list", description: path });
      return;
    }
    setCreateBinPaths((prev) => [...prev, path]);
  }

  async function handleAddCreateBin(pathOverride?: string) {
    const v = (pathOverride ?? createBinScan).trim();
    if (!v) return;
    if (pathOverride != null) setCreateBinScan(pathOverride);

    setAddingBin(true);
    try {
      const bin = await findBinByPath(warehouse.id, v);
      if (!bin) {
        toast({ title: "Bin not found", description: "Check the path or scan the bin QR.", variant: "destructive" });
        return;
      }
      addBinToList(bin.path);
      setCreateBinScan("");
      createBinInputRef.current?.focus();
    } catch (e) {
      toast({
        title: "Bin lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAddingBin(false);
    }
  }

  function resetCountSession() {
    setPhase("home");
    setCountMode("quick");
    setSelectedTask(null);
    setBinScan("");
    setCartonScan("");
    setActiveBinId(null);
    setActiveBinPath(null);
    setExpectedCartons([]);
    setScannedCartonIds([]);
    setScannedCartonCodes([]);
    setCountedLines([]);
    setCountNotes("");
  }

  function openAssignedCount(task: WarehouseCycleCountTaskDoc) {
    setCountMode("assigned");
    setSelectedTask(task);
    setPhase("bin-scan");
    setBinScan("");
    setCartonScan("");
    setActiveBinId(null);
    setActiveBinPath(null);
    setTimeout(() => binInputRef.current?.focus(), 50);
  }

  async function handleQuickBinScan(pathOverride?: string) {
    const v = (pathOverride ?? binScan).trim();
    if (!v) return;
    if (pathOverride != null) setBinScan(pathOverride);

    setResolvingBin(true);
    try {
      const started = await startQuickBinCount({
        warehouseId: warehouse.id,
        pathOrBarcode: v,
        createdBy: operatorId,
      });
      setCountMode("quick");
      setSelectedTask(started.task);
      setActiveBinId(started.bin.id);
      setActiveBinPath(started.bin.path);
      setExpectedCartons(started.expectedCartons);
      setScannedCartonIds([]);
      setScannedCartonCodes([]);
      setCountedLines(defaultCountedLines(started.expectedLines));
      setCountNotes("");
      setPhase("counting");
      setTimeout(() => cartonInputRef.current?.focus(), 50);
    } catch (e) {
      toast({
        title: "Could not start count",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolvingBin(false);
    }
  }

  async function handleResolveBin(pathOverride?: string) {
    if (!selectedTask) return;
    const v = (pathOverride ?? binScan).trim();
    if (!v) return;
    if (pathOverride != null) setBinScan(pathOverride);

    setResolvingBin(true);
    try {
      const resolved = await resolveTaskBinScan({
        warehouseId: warehouse.id,
        task: selectedTask,
        pathOrBarcode: v,
      });
      if (!resolved) {
        toast({ title: "Bin not found", variant: "destructive" });
        return;
      }

      const snapshot = await buildExpectedLinesForBin(warehouse.id, resolved.bin.id);
      setActiveBinId(resolved.bin.id);
      setActiveBinPath(resolved.bin.path);
      setExpectedCartons(snapshot.expectedCartons);
      setScannedCartonIds([]);
      setScannedCartonCodes([]);
      setCountedLines(defaultCountedLines(snapshot.expectedLines));
      setCountNotes("");
      setPhase("counting");
      setTimeout(() => cartonInputRef.current?.focus(), 50);
    } catch (e) {
      toast({
        title: "Bin lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolvingBin(false);
    }
  }

  async function handleCartonScan(pathOverride?: string) {
    const v = (pathOverride ?? cartonScan).trim();
    if (!v || !activeBinId) return;
    if (pathOverride != null) setCartonScan(pathOverride);

    setResolvingCarton(true);
    try {
      const scan = await resolveScan(warehouse.id, v);
      if (scan.kind !== "carton") {
        toast({ title: "Carton not found", variant: "destructive" });
        return;
      }

      const expected = expectedCartons.find((c) => c.id === scan.carton.id);
      if (!expected) {
        toast({
          title: "Unexpected carton",
          description: `${scan.carton.cartonCode} is not expected in this bin.`,
          variant: "destructive",
        });
        return;
      }

      if (scannedCartonIds.includes(scan.carton.id)) {
        toast({ title: "Already scanned", description: scan.carton.cartonCode });
        setCartonScan("");
        return;
      }

      setScannedCartonIds((prev) => [...prev, scan.carton.id]);
      setScannedCartonCodes((prev) => [...prev, scan.carton.cartonCode]);
      setCartonScan("");
      toast({ title: "Carton verified", description: scan.carton.cartonCode });
    } catch (e) {
      toast({
        title: "Scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolvingCarton(false);
    }
  }

  function updateCountedQty(key: string, qty: number) {
    setCountedLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const countedQty = Math.max(0, Math.floor(qty));
        return {
          ...line,
          countedQty,
          variance: countedQty - line.expectedQty,
        };
      })
    );
  }

  function updateVarianceReason(
    key: string,
    reason: WarehouseCycleCountCountedLine["varianceReason"]
  ) {
    setCountedLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, varianceReason: reason } : line))
    );
  }

  function updateVarianceNotes(key: string, notes: string) {
    setCountedLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, varianceNotes: notes } : line))
    );
  }

  const allCartonsScanned =
    expectedCartons.length === 0 ||
    expectedCartons.every((c) => scannedCartonIds.includes(c.id));

  const hasUnresolvedVariance = countedLines.some(
    (l) =>
      l.variance !== 0 &&
      (!l.varianceReason || (l.varianceReason === "other" && !l.varianceNotes?.trim()))
  );

  const canSubmit =
    activeBinId &&
    selectedTask &&
    allCartonsScanned &&
    !hasUnresolvedVariance &&
    !submitting;

  async function handleSubmitCount() {
    if (!canSubmit || !selectedTask || !activeBinId) return;
    setSubmitting(true);
    try {
      await submitBinCycleCount({
        warehouseId: warehouse.id,
        taskId: selectedTask.id,
        binId: activeBinId,
        scannedCartonIds,
        scannedCartonCodes,
        countedLines,
        operatorId,
        notes: countNotes,
      });

      toast({
        title: "Bin count saved",
        description: activeBinPath ?? activeBinId,
      });

      const refreshed = await loadActiveCycleCountTasks(warehouse.id);
      setTasks(refreshed);
      const updated = refreshed.find((t) => t.id === selectedTask.id);
      if (updated && updated.status === "completed") {
        toast({ title: "Count complete", description: updated.title });
        resetCountSession();
        if (canManageTasks) {
          const recent = await loadRecentCycleCountTasks(warehouse.id, 15);
          setRecentTasks(recent);
        }
        return;
      }

      if (updated) {
        setSelectedTask(updated);
        setPhase("bin-scan");
        setActiveBinId(null);
        setActiveBinPath(null);
        setBinScan("");
        setTimeout(() => binInputRef.current?.focus(), 50);
      } else {
        resetCountSession();
      }
    } catch (e) {
      toast({
        title: "Submit failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateRandom() {
    const n = parseInt(createRandomCount, 10);
    if (!n || n < 1 || n > 20) {
      toast({ title: "Pick 1–20 bins", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const id = await createSpotCountTask({
        warehouseId: warehouse.id,
        randomCount: n,
        title: createTitle.trim() || undefined,
        createdBy: operatorId,
      });
      toast({ title: "Spot count assigned", description: `${n} random bins` });
      setCreateTitle("");
      await loadTasks();
      const task = await loadActiveCycleCountTasks(warehouse.id);
      const created = task.find((t) => t.id === id);
      if (created) openAssignedCount(created);
    } catch (e) {
      toast({
        title: "Create failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateManual() {
    if (createBinPaths.length === 0) {
      toast({ title: "Add at least one bin", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const binIds: string[] = [];
      for (const path of createBinPaths) {
        const bin = await findBinByPath(warehouse.id, path);
        if (bin) binIds.push(bin.id);
      }
      const id = await createSpotCountTask({
        warehouseId: warehouse.id,
        binIds,
        title: createTitle.trim() || undefined,
        createdBy: operatorId,
      });
      toast({ title: "Assigned count created" });
      setCreateTitle("");
      setCreateBinPaths([]);
      await loadTasks();
      const task = await loadActiveCycleCountTasks(warehouse.id);
      const created = task.find((t) => t.id === id);
      if (created) openAssignedCount(created);
    } catch (e) {
      toast({
        title: "Create failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    try {
      await cancelCycleCountTask({ warehouseId: warehouse.id, taskId });
      toast({ title: "Assigned count cancelled" });
      await loadTasks();
      if (selectedTask?.id === taskId) resetCountSession();
    } catch (e) {
      toast({
        title: "Cancel failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  function renderHome() {
    if (loadingTasks) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <Card className="border-orange-200/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              Count this bin
            </CardTitle>
            <CardDescription>
              Scan any storage bin to verify cartons and quantities. Use this for everyday spot
              checks — no setup required.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              ref={binInputRef}
              value={binScan}
              onChange={(e) => setBinScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleQuickBinScan();
              }}
              placeholder="Bin path or barcode"
              className="font-mono"
              disabled={resolvingBin}
            />
            <ScanCameraButton onScan={(v) => void handleQuickBinScan(v)} />
          </CardContent>
        </Card>

        {assignedTasks.length > 0 ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Assigned counts</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your supervisor planned these bins for today&apos;s audit. Open a list and count
                each bin in it.
              </p>
            </div>
            {renderAssignedList()}
          </div>
        ) : null}
      </div>
    );
  }

  function renderAssignedList() {
    return (
      <div className="space-y-3">
        {assignedTasks.map((task) => {
          const done = task.completedBinIds.length;
          const total = task.binIds.length;
          return (
            <Card
              key={task.id}
              className="cursor-pointer hover:border-orange-300 transition-colors"
              onClick={() => openAssignedCount(task)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{task.title}</CardTitle>
                    <CardDescription>
                      {total > 1 ? "Planned count" : "Spot count"} · {done}/{total} bins done
                    </CardDescription>
                  </div>
                  <Badge variant={task.status === "in_progress" ? "default" : "secondary"}>
                    {task.status.replace("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {task.binPaths.map((path, i) => (
                    <Badge
                      key={task.binIds[i] ?? path}
                      variant={
                        task.completedBinIds.includes(task.binIds[i]) ? "outline" : "secondary"
                      }
                      className="text-xs font-mono"
                    >
                      {task.completedBinIds.includes(task.binIds[i]) ? "✓ " : ""}
                      {path}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  function renderCounting() {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => {
            if (countMode === "quick") resetCountSession();
            else setPhase("bin-scan");
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {countMode === "quick" ? "Back" : "Back to assigned list"}
        </Button>

        <Card className="border-orange-200/60">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-lg">{activeBinPath}</CardTitle>
            <CardDescription>
              Scan each expected carton, then confirm quantities. Variances need a reason.
            </CardDescription>
          </CardHeader>
        </Card>

        {expectedCartons.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              System shows this bin as empty. Confirm zero stock and submit.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ScanLine className="h-4 w-4" />
                  Verify cartons
                </CardTitle>
                <CardDescription>
                  {scannedCartonIds.length}/{expectedCartons.length} scanned
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    ref={cartonInputRef}
                    value={cartonScan}
                    onChange={(e) => setCartonScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCartonScan();
                    }}
                    placeholder="Scan CTN / PKG barcode"
                    className="font-mono"
                    disabled={resolvingCarton}
                  />
                  <ScanCameraButton onScan={(v) => void handleCartonScan(v)} />
                </div>
                <ul className="space-y-1">
                  {expectedCartons.map((c) => {
                    const done = scannedCartonIds.includes(c.id);
                    return (
                      <li
                        key={c.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-mono",
                          done ? "bg-green-50 dark:bg-green-950/30" : "bg-muted/50"
                        )}
                      >
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border shrink-0" />
                        )}
                        {c.code}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Quantities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {countedLines.map((line) => (
                  <div key={line.key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium font-mono">{line.sku}</p>
                        {line.lot ? (
                          <p className="text-xs text-muted-foreground">Lot {line.lot}</p>
                        ) : null}
                      </div>
                      <Badge variant={line.condition === "damaged" ? "destructive" : "secondary"}>
                        Expected {line.expectedQty}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="shrink-0 text-xs">Counted</Label>
                      <Input
                        type="number"
                        min={0}
                        value={line.countedQty}
                        onChange={(e) =>
                          updateCountedQty(line.key, parseInt(e.target.value, 10) || 0)
                        }
                        className="w-24"
                      />
                      {line.variance !== 0 ? (
                        <Badge variant="destructive">
                          {line.variance > 0 ? "+" : ""}
                          {line.variance}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Match</Badge>
                      )}
                    </div>
                    {line.variance !== 0 ? (
                      <div className="space-y-2 pt-1">
                        <Select
                          value={line.varianceReason ?? ""}
                          onValueChange={(v) =>
                            updateVarianceReason(
                              line.key,
                              v as WarehouseCycleCountCountedLine["varianceReason"]
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Variance reason" />
                          </SelectTrigger>
                          <SelectContent>
                            {CYCLE_COUNT_VARIANCE_REASONS.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {line.varianceReason === "other" ? (
                          <Textarea
                            placeholder="Explain variance…"
                            value={line.varianceNotes ?? ""}
                            onChange={(e) => updateVarianceNotes(line.key, e.target.value)}
                            rows={2}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="count-notes">Notes (optional)</Label>
          <Textarea
            id="count-notes"
            value={countNotes}
            onChange={(e) => setCountNotes(e.target.value)}
            rows={2}
            placeholder="Floor notes for this bin count"
          />
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!canSubmit}
          onClick={() => void handleSubmitCount()}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Submit bin count
        </Button>
      </div>
    );
  }

  function renderBinScan() {
    if (!selectedTask) return null;
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={resetCountSession}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selectedTask.title}</CardTitle>
            <CardDescription>
              Count each bin on this list. Scan a bin below — it must match one of the pending
              locations.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground pb-0">
            Progress: {selectedTask.completedBinIds.length}/{selectedTask.binIds.length} bins
          </CardContent>
          {canManageTasks ? (
            <CardContent className="pt-3">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => void handleCancelTask(selectedTask.id)}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Cancel assigned count
              </Button>
            </CardContent>
          ) : null}
        </Card>

        {pendingBins.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pending bins</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {pendingBins.map((b) => (
                <Badge key={b.id} variant="secondary" className="font-mono">
                  {b.path}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-orange-200/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              Scan bin
            </CardTitle>
            <CardDescription>Scan the bin QR to start counting that location.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              ref={binInputRef}
              value={binScan}
              onChange={(e) => setBinScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleResolveBin();
              }}
              placeholder="Bin path or barcode"
              className="font-mono"
              disabled={resolvingBin}
            />
            <ScanCameraButton onScan={(v) => void handleResolveBin(v)} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const mainContent =
    phase === "counting"
      ? renderCounting()
      : phase === "bin-scan"
        ? renderBinScan()
        : renderHome();

  if (!canManageTasks) {
    return (
      <div className="space-y-4 max-w-xl">
        <WarehouseOpsHeader title="Cycle count" />
        {phase !== "home" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
            {selectedTask?.title}
          </div>
        ) : null}
        {mainContent}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <WarehouseOpsHeader title="Cycle count" />
      {phase === "home" ? (
        <Tabs defaultValue="floor" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="floor">Count bins</TabsTrigger>
            <TabsTrigger value="plan">Plan for team</TabsTrigger>
          </TabsList>
          <TabsContent value="floor" className="mt-4 space-y-4">
            {mainContent}
            {recentTasks.length > 0 ? (
              <div className="space-y-2 pt-4 border-t">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-muted-foreground">Recent results</p>
                  {canOpenAdminReports ? (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                      <Link href="/admin/dashboard/cycle-count-reports">
                        Open full report
                      </Link>
                    </Button>
                  ) : null}
                </div>
                {recentTasks
                  .filter((t) => t.status === "completed" || t.status === "cancelled")
                  .slice(0, 5)
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="w-full text-sm flex justify-between gap-2 rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                      onClick={() => setViewingTask(t)}
                    >
                      <span className="truncate">{t.title}</span>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {t.status}
                        {t.binResults.some((b) => b.hasVariance) ? " · variance" : ""}
                      </Badge>
                    </button>
                  ))}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="plan" className="mt-4 space-y-4">
            <Card className="bg-muted/40">
              <CardContent className="pt-4 text-sm text-muted-foreground">
                Use this when you want the floor team to count specific bins today — for example a
                random audit or a list of problem locations. Workers will see it under{" "}
                <span className="font-medium text-foreground">Assigned counts</span>. For ad-hoc
                checks, they can scan any bin on the Count bins tab without planning first.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Random audit</CardTitle>
                <CardDescription>
                  System picks bins that currently have stock. The team works through the assigned
                  list.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Label (optional)</Label>
                  <Input
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="e.g. Tuesday spot check"
                  />
                </div>
                <div className="space-y-1">
                  <Label>How many bins?</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={createRandomCount}
                    onChange={(e) => setCreateRandomCount(e.target.value)}
                  />
                </div>
                <Button disabled={creating} onClick={() => void handleCreateRandom()}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Assign random bins to team
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Specific bin list</CardTitle>
                <CardDescription>
                  Add bins by scanning, typing the path, or picking from the list below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="plan-bin-scan">Scan or type bin</Label>
                  <div className="flex gap-2">
                    <Input
                      id="plan-bin-scan"
                      ref={createBinInputRef}
                      value={createBinScan}
                      onChange={(e) => setCreateBinScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleAddCreateBin();
                      }}
                      placeholder="Scan QR or e.g. NJ02-A-R1-BA1-L1-B01"
                      className="font-mono"
                      disabled={addingBin}
                    />
                    <ScanCameraButton
                      onScan={(v) => void handleAddCreateBin(v)}
                      scannerTitle="Scan bin label"
                      scannerDescription="Point at the bin QR or barcode"
                      disabled={addingBin}
                    />
                    <Button
                      type="button"
                      onClick={() => void handleAddCreateBin()}
                      disabled={addingBin || !createBinScan.trim()}
                    >
                      {addingBin ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <Label htmlFor="plan-bin-search">Or select from warehouse bins</Label>
                  <Input
                    id="plan-bin-search"
                    value={binPickerQuery}
                    onChange={(e) => setBinPickerQuery(e.target.value)}
                    onFocus={() => void ensureWarehouseBinsLoaded()}
                    placeholder="Search by path or area…"
                    className="font-mono"
                  />
                  <div className="rounded-md border max-h-48 overflow-y-auto">
                    {binPickerLoading ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading bins…
                      </div>
                    ) : warehouseBins.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        Tap search above to load bins, or scan a label.
                      </p>
                    ) : filteredPickerBins.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No matching bins.</p>
                    ) : (
                      <ul className="divide-y">
                        {filteredPickerBins.map((bin) => (
                          <li key={bin.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                              onClick={() => addBinToList(bin.path)}
                            >
                              <span className="font-mono">{bin.path}</span>
                              <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {createBinPaths.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Bins on this count ({createBinPaths.length})</Label>
                    <div className="flex flex-wrap gap-1">
                      {createBinPaths.map((path) => (
                        <Badge key={path} variant="secondary" className="font-mono gap-1">
                          {path}
                          <button
                            type="button"
                            className="ml-1 hover:text-destructive"
                            aria-label={`Remove ${path}`}
                            onClick={() =>
                              setCreateBinPaths((prev) => prev.filter((p) => p !== path))
                            }
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Button
                  className="w-full"
                  disabled={creating || createBinPaths.length === 0}
                  onClick={() => void handleCreateManual()}
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Assign {createBinPaths.length} bin
                  {createBinPaths.length === 1 ? "" : "s"} to team
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
            {selectedTask?.title}
          </div>
          {mainContent}
        </>
      )}

      <Dialog open={!!viewingTask} onOpenChange={(open) => !open && setViewingTask(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cycle count result</DialogTitle>
            <DialogDescription>
              Expected vs counted quantities, variance reasons, and remarks.
            </DialogDescription>
          </DialogHeader>
          {viewingTask ? <CycleCountTaskDetail task={viewingTask} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
