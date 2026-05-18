"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { Loader2, MapPin, Pencil, Plus, Printer, Trash2, Warehouse } from "lucide-react";
import type { Location, WarehouseAreaDoc, WarehouseBinDoc, WarehouseDoc } from "@/types";
import {
  addWarehouseCustomPurpose,
  createWarehouse,
  createWarehouseArea,
  deleteWarehouseCascade,
  generateWarehouseBinsFromDetailedRack,
  setWarehouseBinActive,
  updateWarehouse,
  updateWarehouseArea,
} from "@/lib/warehouse-firestore";
import { buildWarehouseBinLabelsPdf, downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
import { buildBinPath, compareBinPaths, isValidPathSegment } from "@/lib/warehouse-bin-path";
import {
  buildBinSlotCodes,
  buildBaysPerRowFromCounts,
  buildLevelCodes,
  buildRowCodes,
  buildRowCodesAfterExisting,
  countBinSlotsInDetailedRack,
} from "@/lib/warehouse-storage-layout";
import { formatPurposesList, getAreaPurposes } from "@/lib/warehouse-area-purposes";
import { WarehouseAreaPurposesField } from "@/components/admin/warehouse-area-purposes-field";

type RackWizardMode = "new-area" | "extend-area";

export function WarehouseManagement() {
  const { toast } = useToast();
  const { data: warehouses, loading: whLoading } = useCollection<WarehouseDoc>("warehouses");
  const { data: locations } = useCollection<Location>("locations");

  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    if (!selectedId && warehouses.length > 0) {
      setSelectedId(warehouses[0].id);
    }
    if (selectedId && !warehouses.some((w) => w.id === selectedId)) {
      setSelectedId(warehouses[0]?.id || "");
    }
  }, [warehouses, selectedId]);

  const selected = useMemo(
    () => warehouses.find((w) => w.id === selectedId) || null,
    [warehouses, selectedId]
  );

  const binsPath = selectedId ? `warehouses/${selectedId}/bins` : "";
  const areasPath = selectedId ? `warehouses/${selectedId}/areas` : "";
  const { data: bins, loading: binsLoading } = useCollection<WarehouseBinDoc>(binsPath);
  const { data: areas, loading: areasLoading } = useCollection<WarehouseAreaDoc>(areasPath);

  const [binSearch, setBinSearch] = useState("");
  const filteredBins = useMemo(() => {
    const q = binSearch.trim().toLowerCase();
    const subset = !q.length ? bins.slice() : bins.filter((b) => (b.path || "").toLowerCase().includes(q));
    subset.sort((a, b) => compareBinPaths(a.path, b.path));
    return subset;
  }, [bins, binSearch]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newLinked, setNewLinked] = useState<string>("__none__");
  const [saving, setSaving] = useState(false);

  type AreaWizardStep = "details" | "purposes" | "shelving" | "rows" | "bays" | "rackLevels" | "rackBins" | "review";
  const [areaWizardOpen, setAreaWizardOpen] = useState(false);
  const [rackWizardMode, setRackWizardMode] = useState<RackWizardMode>("new-area");
  const [rackTargetAreaId, setRackTargetAreaId] = useState<string | null>(null);
  const [wizStep, setWizStep] = useState<AreaWizardStep>("details");
  const [wizCode, setWizCode] = useState("");
  const [wizName, setWizName] = useState("");
  const [wizPurposes, setWizPurposes] = useState<string[]>(["Storage"]);
  const [wizAddShelving, setWizAddShelving] = useState(true);
  const [wizTemporaryShelf, setWizTemporaryShelf] = useState(false);
  const [wizRowCountStr, setWizRowCountStr] = useState("1");
  const [wizBayCounts, setWizBayCounts] = useState<number[]>([]);
  const [wizLevelsPerBay, setWizLevelsPerBay] = useState<number[][]>([]);
  const [wizBinsPerLevel, setWizBinsPerLevel] = useState<number[][][]>([]);
  const [wizSaving, setWizSaving] = useState(false);

  const [editAreaOpen, setEditAreaOpen] = useState(false);
  const [editAreaId, setEditAreaId] = useState<string | null>(null);
  const [editAreaCode, setEditAreaCode] = useState("");
  const [editAreaName, setEditAreaName] = useState("");
  const [editAreaPurposes, setEditAreaPurposes] = useState<string[]>([]);

  const [pdfAreaFilter, setPdfAreaFilter] = useState("__all__");
  const [pdfRowFilter, setPdfRowFilter] = useState("__all__");
  const [pdfBlockFilter, setPdfBlockFilter] = useState("__all__");
  const [pdfCreatedSince, setPdfCreatedSince] = useState("");

  const resetAreaWizard = () => {
    setRackWizardMode("new-area");
    setRackTargetAreaId(null);
    setWizStep("details");
    setWizCode("");
    setWizName("");
    setWizPurposes(["Storage"]);
    setWizAddShelving(true);
    setWizTemporaryShelf(false);
    setWizRowCountStr("1");
    setWizBayCounts([]);
    setWizLevelsPerBay([]);
    setWizBinsPerLevel([]);
  };

  const existingRowsForRackTarget = useMemo(() => {
    if (!rackTargetAreaId) return [] as string[];
    const area = areas.find((a) => a.id === rackTargetAreaId);
    if (!area) return [];
    const codes = new Set<string>();
    for (const b of bins) {
      if (b.area === area.code && b.row) codes.add(b.row);
    }
    return [...codes].sort((a, b) => a.localeCompare(b));
  }, [areas, bins, rackTargetAreaId]);

  const layoutBlockOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bins) {
      if (b.layoutBlockId) ids.add(b.layoutBlockId);
    }
    return [...ids].sort();
  }, [bins]);

  const pdfRowOptions = useMemo(() => {
    const rows = new Set<string>();
    const areaCode =
      pdfAreaFilter === "__all__" ? null : areas.find((a) => a.id === pdfAreaFilter)?.code;
    for (const b of bins) {
      if (areaCode && b.area !== areaCode) continue;
      if (b.row) rows.add(b.row);
    }
    return [...rows].sort((a, b) => a.localeCompare(b));
  }, [bins, areas, pdfAreaFilter]);

  const openExtendShelving = (area: WarehouseAreaDoc) => {
    resetAreaWizard();
    setRackWizardMode("extend-area");
    setRackTargetAreaId(area.id);
    setWizCode(area.code);
    setWizName(area.name || "");
    setWizRowCountStr("1");
    setWizStep("rows");
    setAreaWizardOpen(true);
  };

  const openEditArea = (area: WarehouseAreaDoc) => {
    setEditAreaId(area.id);
    setEditAreaCode(area.code);
    setEditAreaName(area.name || "");
    setEditAreaPurposes(getAreaPurposes(area));
    setEditAreaOpen(true);
  };

  const handleSaveEditArea = async () => {
    if (!selected || !editAreaId) return;
    setSaving(true);
    try {
      await updateWarehouseArea(selected.id, editAreaId, {
        code: editAreaCode,
        name: editAreaName,
        purposes: editAreaPurposes,
      });
      toast({ title: "Area updated" });
      setEditAreaOpen(false);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomPurpose = async (label: string) => {
    if (!selected) return;
    await addWarehouseCustomPurpose(selected.id, label);
  };

  const parseBoundedInt = (raw: string, label: string, min: number, max: number): number => {
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
    }
    return n;
  };

  const resolveWizardRowCodes = (rowCount: number): string[] =>
    rackWizardMode === "extend-area"
      ? buildRowCodesAfterExisting(existingRowsForRackTarget, rowCount)
      : buildRowCodes(rowCount);

  const wizGridLayout = useMemo(() => {
    try {
      const rowCount = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
      if (wizBayCounts.length !== rowCount) return null;
      for (const m of wizBayCounts) {
        if (!Number.isFinite(m) || m < 1 || m > 99) return null;
      }
      const rowCodes =
        rackWizardMode === "extend-area"
          ? buildRowCodesAfterExisting(existingRowsForRackTarget, rowCount)
          : buildRowCodes(rowCount);
      const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
      return { rowCodes, baysByRow };
    } catch {
      return null;
    }
  }, [wizRowCountStr, wizBayCounts, rackWizardMode, existingRowsForRackTarget]);

  const wizardRackLayout = useMemo(() => {
    if (!selected) return null;
    try {
      const rowCount = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
      if (wizBayCounts.length !== rowCount) return null;
      for (let i = 0; i < wizBayCounts.length; i++) {
        const m = wizBayCounts[i];
        if (!Number.isFinite(m) || m < 1 || m > 99) return null;
      }
      const rowCodes =
        rackWizardMode === "extend-area"
          ? buildRowCodesAfterExisting(existingRowsForRackTarget, rowCount)
          : buildRowCodes(rowCount);
      const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
      if (wizLevelsPerBay.length !== rowCodes.length || wizBinsPerLevel.length !== rowCodes.length) return null;
      for (let ri = 0; ri < rowCodes.length; ri++) {
        if (wizLevelsPerBay[ri].length !== baysByRow[ri].length) return null;
        if (wizBinsPerLevel[ri].length !== baysByRow[ri].length) return null;
        for (let bi = 0; bi < baysByRow[ri].length; bi++) {
          const L = wizLevelsPerBay[ri][bi];
          if (!Number.isFinite(L) || L < 1 || L > 99) return null;
          const br = wizBinsPerLevel[ri][bi];
          if (!br || br.length !== L) return null;
          for (const c of br) {
            if (!Number.isFinite(c) || c < 1 || c > 999) return null;
          }
        }
      }
      const estimated = countBinSlotsInDetailedRack(baysByRow, wizLevelsPerBay, wizBinsPerLevel);
      if (!Number.isFinite(estimated)) return null;
      const areaSeg = wizCode.trim();
      if (!isValidPathSegment(areaSeg)) return null;
      const L0 = wizLevelsPerBay[0][0];
      const b0 = wizBinsPerLevel[0][0][0];
      const levelCode = buildLevelCodes(L0)[0];
      const binCode = buildBinSlotCodes(b0)[0];
      const samplePath = buildBinPath(selected.code, areaSeg, rowCodes[0], baysByRow[0][0], levelCode, binCode);
      return {
        rowCodes,
        baysByRow,
        levelsPerBay: wizLevelsPerBay,
        binsPerLevel: wizBinsPerLevel,
        estimated,
        samplePath,
      };
    } catch {
      return null;
    }
  }, [
    selected,
    rackWizardMode,
    existingRowsForRackTarget,
    wizRowCountStr,
    wizBayCounts,
    wizLevelsPerBay,
    wizBinsPerLevel,
    wizCode,
  ]);

  const wizRowLabels = useMemo(() => {
    try {
      const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
      if (rackWizardMode === "extend-area") {
        return buildRowCodesAfterExisting(existingRowsForRackTarget, rc);
      }
      return buildRowCodes(rc);
    } catch {
      return [] as string[];
    }
  }, [wizRowCountStr, rackWizardMode, existingRowsForRackTarget]);

  const [pdfActiveOnly, setPdfActiveOnly] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [deletingWarehouse, setDeletingWarehouse] = useState(false);

  const resetCreateForm = () => {
    setNewCode("");
    setNewName("");
    setNewLinked("__none__");
  };

  const openEdit = () => {
    if (!selected) return;
    setNewCode(selected.code);
    setNewName(selected.name);
    setNewLinked(selected.linkedLocationId || "__none__");
    setEditOpen(true);
  };

  const handleCreateWarehouse = async () => {
    setSaving(true);
    try {
      const id = await createWarehouse({
        code: newCode,
        name: newName,
        linkedLocationId: newLinked === "__none__" ? null : newLinked,
      });
      toast({ title: "Warehouse created", description: `You can now add areas and generate bins.` });
      setCreateOpen(false);
      resetCreateForm();
      setSelectedId(id);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not create warehouse",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateWarehouse = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateWarehouse(selected.id, {
        code: newCode,
        name: newName,
        linkedLocationId: newLinked === "__none__" ? null : newLinked,
      });
      toast({ title: "Saved", description: "Warehouse updated." });
      setEditOpen(false);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleWarehouseActive = async (active: boolean) => {
    if (!selected) return;
    try {
      await updateWarehouse(selected.id, { active });
      toast({ title: active ? "Activated" : "Deactivated" });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleDeleteWarehouse = async () => {
    if (!selected) return;
    setDeletingWarehouse(true);
    try {
      const { binsRemoved, areasRemoved } = await deleteWarehouseCascade(selected.id);
      const next = warehouses.filter((w) => w.id !== selected.id);
      setSelectedId(next[0]?.id ?? "");
      toast({
        title: "Warehouse deleted",
        description: `Removed ${areasRemoved} area record(s) and ${binsRemoved} bin record(s).`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeletingWarehouse(false);
    }
  };

  const handleWizardCreateZoneOnly = async () => {
    if (!selected || wizSaving) return;
    const c = wizCode.trim();
    if (!c) {
      toast({ variant: "destructive", title: "Area code required" });
      return;
    }
    if (!isValidPathSegment(c)) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description: "Use letters and numbers only (no spaces).",
      });
      return;
    }
    if (!wizPurposes.length) {
      toast({ variant: "destructive", title: "Select at least one purpose" });
      return;
    }
    setWizSaving(true);
    try {
      await createWarehouseArea(selected.id, {
        code: c,
        name: wizName.trim(),
        purposes: wizPurposes,
      });
      toast({ title: "Area added", description: `${c} ? ${formatPurposesList(wizPurposes)}` });
      setAreaWizardOpen(false);
      resetAreaWizard();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not add area",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setWizSaving(false);
    }
  };

  const handleWizardFinishRack = async () => {
    if (!selected || wizSaving) return;
    if (!wizardRackLayout) {
      toast({
        variant: "destructive",
        title: "Review incomplete",
        description: "Go back and check row, bay, level, and bin counts.",
      });
      return;
    }
    if (wizardRackLayout.estimated > 25_000) {
      toast({
        variant: "destructive",
        title: "Too many bins",
        description: `This layout would create about ${wizardRackLayout.estimated.toLocaleString()} bins (limit 25,000). Reduce rows, bays, levels, or bins per level.`,
      });
      return;
    }
    setWizSaving(true);
    try {
      let areaId = rackTargetAreaId;
      if (rackWizardMode === "new-area") {
        areaId = await createWarehouseArea(selected.id, {
          code: wizCode.trim(),
          name: wizName.trim(),
          purposes: wizPurposes.length ? wizPurposes : ["Storage"],
        });
      }
      if (!areaId) throw new Error("Area not found.");

      const layoutBlockId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `block-${Date.now()}`;

      const res = await generateWarehouseBinsFromDetailedRack({
        warehouseId: selected.id,
        warehouseCode: selected.code,
        storageAreaId: areaId,
        rowCodes: wizardRackLayout.rowCodes,
        baysByRow: wizardRackLayout.baysByRow,
        levelsPerBay: wizardRackLayout.levelsPerBay,
        binsPerLevel: wizardRackLayout.binsPerLevel,
        temporary: wizTemporaryShelf,
        layoutBlockId,
      });
      toast({
        title: rackWizardMode === "extend-area" ? "Shelving added" : "Area & bins ready",
        description: `Bins created ${res.created}, skipped (already exist) ${res.skipped}${
          res.failed ? `, failed ${res.failed}` : ""
        }.`,
      });
      if (res.errors.length) console.warn(res.errors);
      setAreaWizardOpen(false);
      resetAreaWizard();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Setup failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setWizSaving(false);
    }
  };

  const handleWizardPrimary = async () => {
    if (!selected) return;
    if (wizStep === "details") {
      const c = wizCode.trim();
      if (!c) {
        toast({ variant: "destructive", title: "Area code required" });
        return;
      }
      if (!isValidPathSegment(c)) {
        toast({
          variant: "destructive",
          title: "Invalid code",
          description: "Use letters and numbers only (no spaces).",
        });
        return;
      }
      if (rackWizardMode === "extend-area") {
        setWizStep("rows");
        return;
      }
      setWizStep("purposes");
      return;
    }
    if (wizStep === "purposes") {
      if (!wizPurposes.length) {
        toast({ variant: "destructive", title: "Select at least one purpose" });
        return;
      }
      setWizStep("shelving");
      return;
    }
    if (wizStep === "shelving") {
      if (!wizAddShelving) {
        await handleWizardCreateZoneOnly();
        return;
      }
      setWizStep("rows");
      return;
    }
    if (wizStep === "rows") {
      try {
        const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
        setWizBayCounts((prev) =>
          Array.from({ length: rc }, (_, i) => {
            const v = prev[i];
            return Number.isFinite(v) && v >= 1 && v <= 99 ? v : 3;
          })
        );
        setWizStep("bays");
      } catch (e: unknown) {
        toast({
          variant: "destructive",
          title: "Check rows",
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    if (wizStep === "bays") {
      try {
        const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
        if (wizBayCounts.length !== rc) {
          toast({
            variant: "destructive",
            title: "Bay counts",
            description: "Each row needs a bay count between 1 and 99.",
          });
          return;
        }
        for (let i = 0; i < wizBayCounts.length; i++) {
          const m = wizBayCounts[i];
          if (!Number.isFinite(m) || m < 1 || m > 99) {
            throw new Error(`Row ${i + 1}: bay count must be between 1 and 99.`);
          }
        }
        const rowCodes = resolveWizardRowCodes(rc);
        const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
        setWizLevelsPerBay(baysByRow.map((bays) => bays.map(() => 4)));
        setWizBinsPerLevel([]);
        setWizStep("rackLevels");
      } catch (e: unknown) {
        toast({
          variant: "destructive",
          title: "Invalid bays",
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    if (wizStep === "rackLevels") {
      try {
        const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
        const rowCodes = resolveWizardRowCodes(rc);
        const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
        for (let ri = 0; ri < baysByRow.length; ri++) {
          for (let bi = 0; bi < baysByRow[ri].length; bi++) {
            const L = wizLevelsPerBay[ri]?.[bi];
            if (!Number.isFinite(L) || L < 1 || L > 99) {
              throw new Error(
                `Row ${rowCodes[ri]} bay ${baysByRow[ri][bi]}: level count must be between 1 and 99.`
              );
            }
          }
        }
        setWizBinsPerLevel(
          baysByRow.map((bays, ri) =>
            bays.map((_, bi) => {
              const L = wizLevelsPerBay[ri][bi];
              return Array.from({ length: L }, (_, li) => {
                const priorBin = wizBinsPerLevel[ri]?.[bi]?.[li];
                return Number.isFinite(priorBin) && priorBin >= 1 && priorBin <= 999 ? priorBin : 3;
              });
            })
          )
        );
        setWizStep("rackBins");
      } catch (e: unknown) {
        toast({
          variant: "destructive",
          title: "Check levels",
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    if (wizStep === "rackBins") {
      try {
        const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
        const rowCodes = resolveWizardRowCodes(rc);
        const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
        for (let ri = 0; ri < baysByRow.length; ri++) {
          for (let bi = 0; bi < baysByRow[ri].length; bi++) {
            const L = wizLevelsPerBay[ri][bi];
            const row = wizBinsPerLevel[ri]?.[bi];
            if (!row || row.length !== L) {
              throw new Error(`Row ${rowCodes[ri]} bay ${baysByRow[ri][bi]}: enter a bin count for every level.`);
            }
            for (let li = 0; li < L; li++) {
              const c = row[li];
              if (!Number.isFinite(c) || c < 1 || c > 999) {
                throw new Error(
                  `Row ${rowCodes[ri]} bay ${baysByRow[ri][bi]} level ${li + 1}: bin count must be 1-999.`
                );
              }
            }
          }
        }
        setWizStep("review");
      } catch (e: unknown) {
        toast({
          variant: "destructive",
          title: "Check bin counts",
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    if (wizStep === "review") {
      await handleWizardFinishRack();
    }
  };

  const handleWizardBack = () => {
    if (wizStep === "purposes") setWizStep("details");
    else if (wizStep === "shelving") setWizStep("purposes");
    else if (wizStep === "rows") {
      if (rackWizardMode === "extend-area") setAreaWizardOpen(false);
      else setWizStep("shelving");
    }
    else if (wizStep === "bays") setWizStep("rows");
    else if (wizStep === "rackLevels") setWizStep("bays");
    else if (wizStep === "rackBins") setWizStep("rackLevels");
    else if (wizStep === "review") setWizStep("rackBins");
  };

  const handlePrintPdf = async () => {
    if (!selected) return;
    let source = pdfActiveOnly ? bins.filter((b) => b.active !== false) : bins.slice();
    if (pdfAreaFilter !== "__all__") {
      const areaCode = areas.find((a) => a.id === pdfAreaFilter)?.code;
      if (areaCode) source = source.filter((b) => b.area === areaCode);
    }
    if (pdfRowFilter !== "__all__") {
      source = source.filter((b) => b.row === pdfRowFilter);
    }
    if (pdfBlockFilter !== "__all__") {
      source = source.filter((b) => b.layoutBlockId === pdfBlockFilter);
    }
    if (pdfCreatedSince.trim()) {
      const sinceMs = Date.parse(pdfCreatedSince);
      if (Number.isFinite(sinceMs)) {
        source = source.filter((b) => {
          const c = b.createdAt;
          if (!c) return false;
          const ms =
            c instanceof Date
              ? c.getTime()
              : typeof (c as { seconds?: number }).seconds === "number"
                ? (c as { seconds: number }).seconds * 1000
                : NaN;
          return Number.isFinite(ms) && ms >= sinceMs;
        });
      }
    }
    if (source.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing to print",
        description: pdfActiveOnly ? "No active bins, or turn off active only." : "This warehouse has no bins yet.",
      });
      return;
    }
    setPrinting(true);
    try {
      const bytes = await buildWarehouseBinLabelsPdf({
        title: `${selected.name} (${selected.code}) — bin labels`,
        bins: source,
        activeOnly: false,
      });
      const safe = selected.code.replace(/[^a-z0-9-_]/gi, "_");
      downloadUint8ArrayAsFile(bytes, `bin-labels-${safe}.pdf`);
      toast({ title: "PDF ready", description: "Your download should start shortly." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "PDF failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPrinting(false);
    }
  };

  const activeLocations = useMemo(
    () => locations.filter((l) => l.active !== false).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [locations]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Warehouse className="h-7 w-7 text-violet-600" />
            Warehouses &amp; bins
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Release 1 / Phase 1 — matches{" "}
            <code className="text-xs bg-muted px-1 rounded">03_WAREHOUSE_WORKFLOW_V2.md</code> (setup) and{" "}
            <code className="text-xs bg-muted px-1 rounded">04_IMPLEMENTATION_PLAN.md</code> (Phase 1). Use the tabs in
            order: <strong className="font-medium text-foreground">Areas</strong> (guided setup creates storage rack
            bins), then <strong className="font-medium text-foreground">Bins</strong> (review paths), then{" "}
            <strong className="font-medium text-foreground">Labels</strong>. Bin paths look like{" "}
            <code className="text-xs bg-muted px-1 rounded">Warehouse-Area-Row-Bay-Level-Bin</code> (same pattern as{" "}
            <code className="text-xs bg-muted px-1 rounded">02_WORKFLOW…</code> label payload).
          </p>
        </div>
        <Button onClick={() => { resetCreateForm(); setCreateOpen(true); }} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          New warehouse
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Warehouses</CardTitle>
            <CardDescription>Select a warehouse: areas, then bins, then labels.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {whLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : warehouses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No warehouses yet. Create one to begin.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {warehouses.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSelectedId(w.id)}
                    className={`text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                      w.id === selectedId
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40"
                        : "border-transparent hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{w.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {w.code}
                      </Badge>
                      {w.active === false ? (
                        <span className="text-amber-700">Inactive</span>
                      ) : (
                        <span className="text-green-700">Active</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {!selected ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              Select or create a warehouse.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b pb-4">
              <div>
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="secondary" className="font-mono">
                    {selected.code}
                  </Badge>
                  {selected.linkedLocationId && (
                    <span className="text-xs">
                      Linked location:{" "}
                      {locations.find((l) => l.id === selected.linkedLocationId)?.name ||
                        selected.linkedLocationId}
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <Label htmlFor="wh-active" className="text-muted-foreground">
                    Active
                  </Label>
                  <Switch
                    id="wh-active"
                    checked={selected.active !== false}
                    onCheckedChange={(v) => handleToggleWarehouseActive(v)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={openEdit}>
                  Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deletingWarehouse}>
                      {deletingWarehouse ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          Delete
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this warehouse?</AlertDialogTitle>
                      <AlertDialogDescription className="space-y-2">
                        <span>
                          This will permanently delete <strong>{selected.name}</strong> ({selected.code}) and all of
                          its <strong>{areas.length}</strong> area record(s) and <strong>{bins.length}</strong> bin
                          record(s). This cannot be undone.
                        </span>
                        {selected.linkedLocationId ? (
                          <span className="block text-amber-700 dark:text-amber-300">
                            The linked client location is not deleted — only this warehouse configuration in
                            Firestore.
                          </span>
                        ) : null}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deletingWarehouse}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        disabled={deletingWarehouse}
                        onClick={() => void handleDeleteWarehouse()}
                      >
                        Delete warehouse
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <Tabs defaultValue="areas">
                <TabsList className="flex flex-wrap h-auto gap-1 w-full sm:w-auto">
                  <TabsTrigger value="areas">1 -+ Areas ({areas.length})</TabsTrigger>
                  <TabsTrigger value="bins">2 -+ Bins ({bins.length})</TabsTrigger>
                  <TabsTrigger value="labels">3 -+ Labels</TabsTrigger>
                </TabsList>

                <TabsContent value="areas" className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Design each area your way: pick one or more purposes (including custom labels), optionally add
                    shelving with per-row layout, and extend or add temporary shelves later. Labels can be printed for
                    the whole warehouse or filtered by area, row, or shelf block.
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border rounded-lg p-4 bg-muted/30">
                    <p className="text-sm text-muted-foreground shrink-0">Step-by-step wizard for all area types.</p>
                    <Button
                      type="button"
                      onClick={() => {
                        resetAreaWizard();
                        setAreaWizardOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add area
                    </Button>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Purposes</TableHead>
                          <TableHead className="w-28">Bins</TableHead>
                          <TableHead className="w-28">Active</TableHead>
                          <TableHead className="w-40 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {areasLoading ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-muted-foreground text-sm">
                              Loading…
                            </TableCell>
                          </TableRow>
                        ) : areas.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-muted-foreground text-sm">
                              No area records yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          areas.map((a) => {
                            const binCount = bins.filter((b) => b.area === a.code).length;
                            return (
                              <TableRow key={a.id}>
                                <TableCell className="font-mono">{a.code}</TableCell>
                                <TableCell>{a.name || "?"}</TableCell>
                                <TableCell className="text-sm max-w-[240px]">
                                  {formatPurposesList(getAreaPurposes(a))}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{binCount}</TableCell>
                                <TableCell>
                                  <Switch
                                    checked={a.active !== false}
                                    onCheckedChange={async (v) => {
                                      try {
                                        await updateWarehouseArea(selected.id, a.id, { active: v });
                                      } catch (e: unknown) {
                                        toast({
                                          variant: "destructive",
                                          title: "Update failed",
                                          description: e instanceof Error ? e.message : String(e),
                                        });
                                      }
                                    }}
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openEditArea(a)}
                                    >
                                      <Pencil className="h-3.5 w-3.5 mr-1" />
                                      Edit
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => openExtendShelving(a)}
                                    >
                                      <Plus className="h-3.5 w-3.5 mr-1" />
                                      Shelving
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="bins" className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Bins are created from <strong className="text-foreground">Areas</strong> (add area with shelving, or
                    use <strong className="text-foreground">Shelving</strong> on an existing area). Search by path and
                    toggle active bins.
                  </p>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Bin list</h3>
                    <Input
                      placeholder="Filter by path"
                      value={binSearch}
                      onChange={(e) => setBinSearch(e.target.value)}
                      className="max-w-sm"
                    />
                    <div className="rounded-md border overflow-x-auto mouse-h-scroll max-h-[480px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead className="w-24">Level</TableHead>
                          <TableHead className="w-28 text-right">Active</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {binsLoading ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground text-sm">
                              Loading bins…
                            </TableCell>
                          </TableRow>
                        ) : filteredBins.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground text-sm">
                              No bins match.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredBins.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="font-mono text-xs">{b.path}</TableCell>
                              <TableCell>{b.level}</TableCell>
                              <TableCell className="text-right">
                                <Switch
                                  checked={b.active !== false}
                                  onCheckedChange={async (v) => {
                                    try {
                                      await setWarehouseBinActive(selected.id, b.id, v);
                                    } catch (e: unknown) {
                                      toast({
                                        variant: "destructive",
                                        title: "Update failed",
                                        description: e instanceof Error ? e.message : String(e),
                                      });
                                    }
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  </div>
                </TabsContent>

                <TabsContent value="labels" className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Print bin label PDFs (same format as before). Filter by area, row, shelf block, or date to print
                    only new shelves.
                  </p>
                  {!bins.length ? (
                    <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                      No bins yet — add shelving in <strong>Areas</strong>, then return here.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-lg border p-4 bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Area</Label>
                      <Select
                        value={pdfAreaFilter}
                        onValueChange={(v) => {
                          setPdfAreaFilter(v);
                          setPdfRowFilter("__all__");
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All areas</SelectItem>
                          {areas.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Row</Label>
                      <Select value={pdfRowFilter} onValueChange={setPdfRowFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All rows</SelectItem>
                          {pdfRowOptions.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Shelf block</Label>
                      <Select value={pdfBlockFilter} onValueChange={setPdfBlockFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All blocks</SelectItem>
                          {layoutBlockOptions.map((id) => (
                            <SelectItem key={id} value={id}>{id.slice(0, 8)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Created since</Label>
                      <Input type="datetime-local" value={pdfCreatedSince} onChange={(e) => setPdfCreatedSince(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 rounded-lg border p-4 bg-muted/30 mt-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Switch id="pdf-active" checked={pdfActiveOnly} onCheckedChange={setPdfActiveOnly} />
                      <Label htmlFor="pdf-active" className="text-muted-foreground cursor-pointer">
                        Active bins only
                      </Label>
                    </div>
                    <Button onClick={handlePrintPdf} disabled={printing || !bins.length}>
                      {printing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Printer className="h-4 w-4 mr-2" />
                          Download label PDF
                        </>
                      )}
                    </Button>
                  </div>
                </TabsContent>

              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New warehouse</DialogTitle>
            <DialogDescription>
              Code appears in every bin path. Use the same style as operations (e.g. NJ02).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="NJ02" />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Jersey 02" />
            </div>
            <div className="space-y-2">
              <Label>Link to existing location (optional)</Label>
              <Select value={newLinked} onValueChange={setNewLinked}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {activeLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Links this warehouse to a row in Assign Location for reporting and user assignment.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateWarehouse} disabled={saving || !newCode.trim() || !newName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit warehouse</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Linked location</Label>
              <Select value={newLinked} onValueChange={setNewLinked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {activeLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateWarehouse} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={areaWizardOpen}
        onOpenChange={(open) => {
          setAreaWizardOpen(open);
          if (!open) resetAreaWizard();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {rackWizardMode === "extend-area" ? "Add shelving" : "Add area"} — guided setup
            </DialogTitle>
            <DialogDescription>
              {wizStep === "details" && "Area code and optional name."}
              {wizStep === "purposes" && "What happens here (any combination; add custom labels)."}
              {wizStep === "shelving" && "Add rack/shelf bins now, or create a zone only."}
              {wizStep === "rows" &&
                (rackWizardMode === "extend-area"
                  ? "How many new rows to add? (continues after existing rows.)"
                  : "How many rack rows in this area?")}
              {wizStep === "bays" && "For each row, how many bays (positions along the aisle)?"}
              {wizStep === "rackLevels" && "For each bay, how many vertical levels (1, 2, 3… in the path)?"}
              {wizStep === "rackBins" && "For each level in each bay, how many bin slots (labeled A1, A2, …)?"}
              {wizStep === "review" && "Confirm before generating bins (existing paths are skipped)."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto min-h-0 flex-1">
            {wizStep === "details" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Area code</Label>
                  <Input
                    value={wizCode}
                    onChange={(e) => setWizCode(e.target.value)}
                    placeholder="A"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Short segment in bin paths (e.g. A, R1).</p>
                </div>
                <div className="space-y-2">
                  <Label>Name (optional)</Label>
                  <Input
                    value={wizName}
                    onChange={(e) => setWizName(e.target.value)}
                    placeholder="Fast-moving pick face"
                  />
                </div>
              </div>
            ) : null}

            {wizStep === "purposes" && rackWizardMode === "new-area" ? (
              <WarehouseAreaPurposesField
                selected={wizPurposes}
                onChange={setWizPurposes}
                warehouseCustomPurposes={selected?.customPurposes}
                otherAreaPurposeLists={areas.map((a) => getAreaPurposes(a))}
                onAddCustomToWarehouse={handleAddCustomPurpose}
                disabled={wizSaving}
              />
            ) : null}

            {wizStep === "shelving" && rackWizardMode === "new-area" ? (
              <div className="space-y-4">
                <Label>Add shelving (bins) in this area?</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={wizAddShelving ? "default" : "outline"}
                    onClick={() => setWizAddShelving(true)}
                  >
                    Yes — design rows / bays / levels
                  </Button>
                  <Button
                    type="button"
                    variant={!wizAddShelving ? "default" : "outline"}
                    onClick={() => setWizAddShelving(false)}
                  >
                    No — zone only (add shelving later)
                  </Button>
                </div>
              </div>
            ) : null}

            {wizStep === "rows" ? (
              <div className="space-y-2">
                {rackWizardMode === "extend-area" ? (
                  <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                    Area <span className="font-mono font-medium">{wizCode}</span>
                    {existingRowsForRackTarget.length > 0 ? (
                      <>
                        {" "}
                        — existing rows:{" "}
                        <span className="font-mono">{existingRowsForRackTarget.join(", ")}</span>
                      </>
                    ) : (
                      " — no rows yet"
                    )}
                  </p>
                ) : null}
                <Label>Number of rows</Label>
                <Input
                  inputMode="numeric"
                  value={wizRowCountStr}
                  onChange={(e) => setWizRowCountStr(e.target.value)}
                  className="max-w-[120px]"
                />
                <p className="text-xs text-muted-foreground">
                  Rows are numbered 01, 02, … (width adjusts for large counts).
                </p>
              </div>
            ) : null}

            {wizStep === "bays" ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Bays are labeled A–Z for up to 26 per row, then 01, 02, … for larger counts.
                </p>
                <ScrollArea className="h-72 rounded-md border p-3">
                  <div className="space-y-3 pr-3">
                    {wizRowLabels.map((rowLabel, i) => (
                      <div key={rowLabel} className="flex items-center gap-3">
                        <span className="text-sm font-mono w-12 shrink-0">{rowLabel}</span>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs text-muted-foreground">Bays in this row</Label>
                          <Input
                            inputMode="numeric"
                            className="max-w-[100px]"
                            value={wizBayCounts[i] != null && wizBayCounts[i] >= 1 ? String(wizBayCounts[i]) : ""}
                            onChange={(e) => {
                              const v = Number.parseInt(e.target.value, 10);
                              setWizBayCounts((arr) => {
                                const next = [...arr];
                                next[i] = Number.isFinite(v) ? v : 0;
                                return next;
                              });
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {wizStep === "rackLevels" && wizGridLayout ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Same idea as bays per row: each bay can have its own number of levels.
                </p>
                <ScrollArea className="h-80 rounded-md border p-3">
                  <div className="space-y-4 pr-3">
                    {wizGridLayout.rowCodes.map((rowLabel, ri) => (
                      <div key={rowLabel} className="space-y-3">
                        <div className="text-xs font-semibold text-muted-foreground">Row {rowLabel}</div>
                        {wizGridLayout.baysByRow[ri].map((bayCode, bi) => (
                          <div key={`${ri}-${bi}`} className="flex flex-wrap items-end gap-3 pl-2">
                            <span className="text-sm font-mono shrink-0">
                              {rowLabel}-{bayCode}
                            </span>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Levels in this bay</Label>
                              <Input
                                inputMode="numeric"
                                className="w-[100px]"
                                value={
                                  wizLevelsPerBay[ri]?.[bi] != null && wizLevelsPerBay[ri][bi] >= 1
                                    ? String(wizLevelsPerBay[ri][bi])
                                    : ""
                                }
                                onChange={(e) => {
                                  const v = Number.parseInt(e.target.value, 10);
                                  setWizLevelsPerBay((prev) => {
                                    if (!wizGridLayout) return prev;
                                    const bayLen = wizGridLayout.baysByRow[ri]?.length ?? 0;
                                    const next = prev.map((row) => [...row]);
                                    if (!next[ri]) next[ri] = [];
                                    while (next[ri].length < bayLen) next[ri].push(4);
                                    next[ri][bi] = Number.isFinite(v) ? v : 0;
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {wizStep === "rackBins" && wizGridLayout ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Slots use codes A1, A2, … within each level.
                </p>
                <ScrollArea className="h-96 max-h-[55vh] rounded-md border p-3">
                  <div className="space-y-6 pr-3">
                    {wizGridLayout.rowCodes.map((rowLabel, ri) => (
                      <div key={rowLabel} className="space-y-3">
                        <div className="text-xs font-semibold text-muted-foreground">Row {rowLabel}</div>
                        {wizGridLayout.baysByRow[ri].map((bayCode, bi) => {
                          const L = wizLevelsPerBay[ri]?.[bi] ?? 0;
                          return (
                            <div key={`${ri}-${bi}`} className="border-l-2 border-muted pl-3 space-y-2">
                              <div className="text-sm font-mono text-foreground">
                                {rowLabel}-{bayCode}{" "}
                                <span className="text-xs text-muted-foreground font-sans">
                                  ({L} level{L !== 1 ? "s" : ""})
                                </span>
                              </div>
                              {Array.from({ length: L }, (_, li) => (
                                <div key={li} className="flex flex-wrap items-end gap-3">
                                  <Label className="text-xs text-muted-foreground w-20 shrink-0">
                                    L{li + 1}
                                  </Label>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Bins on this level</Label>
                                    <Input
                                      inputMode="numeric"
                                      className="w-[100px]"
                                      value={
                                        wizBinsPerLevel[ri]?.[bi]?.[li] != null &&
                                        wizBinsPerLevel[ri][bi][li] >= 1
                                          ? String(wizBinsPerLevel[ri][bi][li])
                                          : ""
                                      }
                                      onChange={(e) => {
                                        const v = Number.parseInt(e.target.value, 10);
                                        setWizBinsPerLevel((prev) => {
                                          const next = prev.map((r) => r.map((b) => [...b]));
                                          if (!next[ri]) next[ri] = [];
                                          while (next[ri].length <= bi) next[ri].push([]);
                                          const row = [...(next[ri][bi] || [])];
                                          while (row.length < L) row.push(3);
                                          row[li] = Number.isFinite(v) ? v : 0;
                                          next[ri][bi] = row;
                                          return next;
                                        });
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {wizStep === "review" ? (
              <div className="space-y-3 text-sm rounded-lg border bg-muted/30 p-4">
                {wizardRackLayout ? (
                  <>
                    <div>
                      <span className="text-muted-foreground">Warehouse — area:</span>{" "}
                      <span className="font-mono">
                        {selected?.code}-{wizCode.trim()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sample bin path:</span>{" "}
                      <span className="font-mono text-xs break-all">{wizardRackLayout.samplePath}</span>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        id="wiz-temp-shelf"
                        checked={wizTemporaryShelf}
                        onCheckedChange={setWizTemporaryShelf}
                      />
                      <Label htmlFor="wiz-temp-shelf" className="text-sm font-normal cursor-pointer">
                        Mark as temporary shelf block
                      </Label>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Estimated new bin records:</span>{" "}
                      <strong className="text-foreground">{wizardRackLayout.estimated.toLocaleString()}</strong>
                      <span className="text-muted-foreground"> (existing paths are skipped)</span>
                    </div>
                    {wizardRackLayout.estimated > 25_000 ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        Over the 25,000 limit for one run. Reduce rows, bays, levels, or bins in the wizard and try
                        again.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground">Fix any invalid counts on the previous steps to see a preview.</p>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-between">
            <div className="flex gap-2 order-2 sm:order-1">
              {wizStep !== "details" ? (
                <Button type="button" variant="outline" onClick={handleWizardBack} disabled={wizSaving}>
                  Back
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2 justify-end order-1 sm:order-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAreaWizardOpen(false);
                  resetAreaWizard();
                }}
                disabled={wizSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleWizardPrimary()}
                disabled={
                  wizSaving ||
                  (wizStep === "review" && (!wizardRackLayout || wizardRackLayout.estimated > 25_000))
                }
              >
                {wizSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : wizStep === "details" ? (
                  "Next"
                ) : wizStep === "purposes" ? (
                  "Next"
                ) : wizStep === "shelving" ? (
                  wizAddShelving ? "Next: rack layout" : "Create area"
                ) : wizStep === "review" ? (
                  rackWizardMode === "extend-area" ? "Add bins" : "Create area & bins"
                ) : (
                  "Next"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editAreaOpen} onOpenChange={setEditAreaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit area</DialogTitle>
            <DialogDescription>Update code, name, and purposes. Shelving is managed via the Shelving button.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Area code</Label>
              <Input
                value={editAreaCode}
                onChange={(e) => setEditAreaCode(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Name (optional)</Label>
              <Input value={editAreaName} onChange={(e) => setEditAreaName(e.target.value)} />
            </div>
            <WarehouseAreaPurposesField
              selected={editAreaPurposes}
              onChange={setEditAreaPurposes}
              warehouseCustomPurposes={selected?.customPurposes}
              otherAreaPurposeLists={areas.map((a) => getAreaPurposes(a))}
              onAddCustomToWarehouse={handleAddCustomPurpose}
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAreaOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveEditArea()} disabled={saving || !editAreaPurposes.length}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
