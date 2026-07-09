"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  clearWarehouseAreaBins,
  createWarehouseArea,
  createWarehouseFromExistingLocation,
  createWarehouseWithLocation,
  deleteWarehouseAreaCascade,
  deleteWarehouseBin,
  deleteWarehouseBinsByAreaRow,
  deleteWarehouseCascade,
  generateWarehouseBinsFromDetailedRack,
  replaceWarehouseAreaRow,
  setWarehouseBinActive,
  updateWarehouse,
  updateWarehouseAreaWithBinSync,
  updateWarehouseBin,
  updateWarehouseWithLocation,
  migrateWarehouseBinPathFormat,
} from "@/lib/warehouse-firestore";
import { binSegmentsNeedMigration } from "@/lib/warehouse-bin-path";
import { WarehouseBinEditDialog } from "@/components/admin/warehouse-bin-edit-dialog";
import { WarehouseCartonManagement } from "@/components/admin/warehouse-carton-management";
import { WarehouseShelvingDialog } from "@/components/admin/warehouse-shelving-dialog";
import {
  WarehouseRowEditDialog,
  type RowRackSavePayload,
} from "@/components/admin/warehouse-row-edit-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  buildRowCodesWithAssignment,
  listGapRowCodes,
  type RowAssignMode,
} from "@/lib/warehouse-row-rack";
import {
  emptyWarehouseLocationForm,
  locationToFormValues,
  resolveCountryFromForm,
  resolveStateFromForm,
  validateWarehouseLocationForm,
  warehouseLocationFormToPayload,
  WarehouseLocationAddressFields,
  type WarehouseLocationFormValues,
} from "@/components/admin/warehouse-location-address-fields";
import { formatLocationPath } from "@/lib/region-display";
import {
  formatWarehouseCodeLabel,
  suggestNextWarehouseCode,
} from "@/lib/warehouse-code-generator";
import { buildWarehouseBinLabelsPdf, downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
import { buildBinPath, compareBinPaths, isValidPathSegment } from "@/lib/warehouse-bin-path";
import {
  buildBinSlotCodes,
  buildBaysPerRowFromCounts,
  buildLevelCodes,
  buildRowCodes,
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
  const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedOrphanId) return;
    if (!selectedId && warehouses.length > 0) {
      setSelectedId(warehouses[0].id);
    }
    if (selectedId && !warehouses.some((w) => w.id === selectedId)) {
      setSelectedId(warehouses[0]?.id || "");
    }
  }, [warehouses, selectedId, selectedOrphanId]);

  const selected = useMemo(
    () => warehouses.find((w) => w.id === selectedId) || null,
    [warehouses, selectedId]
  );

  const binsPath = selectedId ? `warehouses/${selectedId}/bins` : "";
  const areasPath = selectedId ? `warehouses/${selectedId}/areas` : "";
  const { data: bins, loading: binsLoading } = useCollection<WarehouseBinDoc>(binsPath);
  const { data: areas, loading: areasLoading } = useCollection<WarehouseAreaDoc>(areasPath);

  const pathMigrateBusyRef = useRef(false);

  useEffect(() => {
    if (!selected?.id || !selected.code || binsLoading || pathMigrateBusyRef.current) return;
    if (!bins.some((b) => binSegmentsNeedMigration(b))) return;
    pathMigrateBusyRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { updated } = await migrateWarehouseBinPathFormat(selected.id, selected.code);
        if (!cancelled && updated > 0) {
          toast({
            title: "Bin paths updated",
            description: `Updated ${updated} bin(s) to the new barcode format (e.g. ${selected.code}-A-R1-BA1-L1-B01). Reprint labels if they were already on the racks.`,
          });
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Could not update bin paths",
            description: e instanceof Error ? e.message : "Migration failed.",
          });
        }
      } finally {
        pathMigrateBusyRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.code, binsLoading, bins, toast]);

  const [binSearch, setBinSearch] = useState("");
  const [binFilterArea, setBinFilterArea] = useState("__all__");
  const [binFilterRow, setBinFilterRow] = useState("__all__");
  const [binFilterBay, setBinFilterBay] = useState("__all__");
  const [binFilterLevel, setBinFilterLevel] = useState("__all__");
  const [binFilterActive, setBinFilterActive] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    setBinSearch("");
    setBinFilterArea("__all__");
    setBinFilterRow("__all__");
    setBinFilterBay("__all__");
    setBinFilterLevel("__all__");
    setBinFilterActive("all");
    setPdfAreaFilter("__all__");
    setPdfRowFilter("__all__");
    setPdfBayFilter("__all__");
    setPdfLevelFilter("__all__");
    setPdfBinFilter("__all__");
    setPdfCreatedSince("");
  }, [selectedId]);

  const binFilterRowOptions = useMemo(() => {
    const rows = new Set<string>();
    for (const b of bins) {
      if (binFilterArea !== "__all__" && b.area !== binFilterArea) continue;
      if (b.row) rows.add(b.row);
    }
    return [...rows].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, binFilterArea]);

  const binFilterBayOptions = useMemo(() => {
    const bays = new Set<string>();
    for (const b of bins) {
      if (binFilterArea !== "__all__" && b.area !== binFilterArea) continue;
      if (binFilterRow !== "__all__" && b.row !== binFilterRow) continue;
      if (b.bay) bays.add(b.bay);
    }
    return [...bays].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, binFilterArea, binFilterRow]);

  const binFilterLevelOptions = useMemo(() => {
    const levels = new Set<string>();
    for (const b of bins) {
      if (binFilterArea !== "__all__" && b.area !== binFilterArea) continue;
      if (binFilterRow !== "__all__" && b.row !== binFilterRow) continue;
      if (binFilterBay !== "__all__" && b.bay !== binFilterBay) continue;
      if (b.level) levels.add(b.level);
    }
    return [...levels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, binFilterArea, binFilterRow, binFilterBay]);

  const filteredBins = useMemo(() => {
    const q = binSearch.trim().toLowerCase();
    let subset = bins.slice();
    if (q.length) subset = subset.filter((b) => (b.path || "").toLowerCase().includes(q));
    if (binFilterArea !== "__all__") subset = subset.filter((b) => b.area === binFilterArea);
    if (binFilterRow !== "__all__") subset = subset.filter((b) => b.row === binFilterRow);
    if (binFilterBay !== "__all__") subset = subset.filter((b) => b.bay === binFilterBay);
    if (binFilterLevel !== "__all__") subset = subset.filter((b) => b.level === binFilterLevel);
    if (binFilterActive === "active") subset = subset.filter((b) => b.active !== false);
    else if (binFilterActive === "inactive") subset = subset.filter((b) => b.active === false);
    subset.sort((a, b) => compareBinPaths(a.path, b.path));
    return subset;
  }, [bins, binSearch, binFilterArea, binFilterRow, binFilterBay, binFilterLevel, binFilterActive]);

  const binFiltersActive =
    binSearch.trim().length > 0 ||
    binFilterArea !== "__all__" ||
    binFilterRow !== "__all__" ||
    binFilterBay !== "__all__" ||
    binFilterLevel !== "__all__" ||
    binFilterActive !== "all";

  const clearBinFilters = () => {
    setBinSearch("");
    setBinFilterArea("__all__");
    setBinFilterRow("__all__");
    setBinFilterBay("__all__");
    setBinFilterLevel("__all__");
    setBinFilterActive("all");
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [codeSuggestionLabel, setCodeSuggestionLabel] = useState("");
  const [locForm, setLocForm] = useState<WarehouseLocationFormValues>(emptyWarehouseLocationForm);
  const [orphanSetupCode, setOrphanSetupCode] = useState("");
  const [orphanSetupName, setOrphanSetupName] = useState("");
  const [orphanCodeTouched, setOrphanCodeTouched] = useState(false);
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
  const [wizRowAssignMode, setWizRowAssignMode] = useState<RowAssignMode>("fill-gaps");
  const [wizBayCounts, setWizBayCounts] = useState<number[]>([]);
  const [wizLevelsPerBay, setWizLevelsPerBay] = useState<number[][]>([]);
  const [wizBinsPerLevel, setWizBinsPerLevel] = useState<number[][][]>([]);
  const [wizSaving, setWizSaving] = useState(false);

  const [editAreaOpen, setEditAreaOpen] = useState(false);
  const [editAreaId, setEditAreaId] = useState<string | null>(null);
  const [editAreaCode, setEditAreaCode] = useState("");
  const [editAreaName, setEditAreaName] = useState("");
  const [editAreaPurposes, setEditAreaPurposes] = useState<string[]>([]);

  const [editBinOpen, setEditBinOpen] = useState(false);
  const [editBinId, setEditBinId] = useState<string | null>(null);
  const editBin = useMemo(
    () => (editBinId ? bins.find((b) => b.id === editBinId) || null : null),
    [bins, editBinId]
  );

  const [pdfAreaFilter, setPdfAreaFilter] = useState("__all__");
  const [pdfRowFilter, setPdfRowFilter] = useState("__all__");
  const [pdfBayFilter, setPdfBayFilter] = useState("__all__");
  const [pdfLevelFilter, setPdfLevelFilter] = useState("__all__");
  const [pdfBinFilter, setPdfBinFilter] = useState("__all__");
  const [pdfCreatedSince, setPdfCreatedSince] = useState("");
  const [pdfActiveOnly, setPdfActiveOnly] = useState(true);

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
    setWizRowAssignMode("fill-gaps");
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

  const pdfAreaCode = useMemo(
    () => (pdfAreaFilter === "__all__" ? null : areas.find((a) => a.id === pdfAreaFilter)?.code ?? null),
    [pdfAreaFilter, areas]
  );

  const pdfRowOptions = useMemo(() => {
    const rows = new Set<string>();
    for (const b of bins) {
      if (pdfAreaCode && b.area !== pdfAreaCode) continue;
      if (b.row) rows.add(b.row);
    }
    return [...rows].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, pdfAreaCode]);

  const pdfBayOptions = useMemo(() => {
    const bays = new Set<string>();
    for (const b of bins) {
      if (pdfAreaCode && b.area !== pdfAreaCode) continue;
      if (pdfRowFilter !== "__all__" && b.row !== pdfRowFilter) continue;
      if (b.bay) bays.add(b.bay);
    }
    return [...bays].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, pdfAreaCode, pdfRowFilter]);

  const pdfLevelOptions = useMemo(() => {
    const levels = new Set<string>();
    for (const b of bins) {
      if (pdfAreaCode && b.area !== pdfAreaCode) continue;
      if (pdfRowFilter !== "__all__" && b.row !== pdfRowFilter) continue;
      if (pdfBayFilter !== "__all__" && b.bay !== pdfBayFilter) continue;
      if (b.level) levels.add(b.level);
    }
    return [...levels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, pdfAreaCode, pdfRowFilter, pdfBayFilter]);

  const pdfBinOptions = useMemo(() => {
    const list: WarehouseBinDoc[] = [];
    for (const b of bins) {
      if (pdfAreaCode && b.area !== pdfAreaCode) continue;
      if (pdfRowFilter !== "__all__" && b.row !== pdfRowFilter) continue;
      if (pdfBayFilter !== "__all__" && b.bay !== pdfBayFilter) continue;
      if (pdfLevelFilter !== "__all__" && b.level !== pdfLevelFilter) continue;
      list.push(b);
    }
    list.sort((a, b) => compareBinPaths(a.path, b.path));
    return list;
  }, [bins, pdfAreaCode, pdfRowFilter, pdfBayFilter, pdfLevelFilter]);

  const pdfBinsForLabels = useMemo(() => {
    let source = pdfActiveOnly ? bins.filter((b) => b.active !== false) : bins.slice();
    if (pdfAreaCode) source = source.filter((b) => b.area === pdfAreaCode);
    if (pdfRowFilter !== "__all__") source = source.filter((b) => b.row === pdfRowFilter);
    if (pdfBayFilter !== "__all__") source = source.filter((b) => b.bay === pdfBayFilter);
    if (pdfLevelFilter !== "__all__") source = source.filter((b) => b.level === pdfLevelFilter);
    if (pdfBinFilter !== "__all__") source = source.filter((b) => b.id === pdfBinFilter);
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
    source.sort((a, b) => compareBinPaths(a.path, b.path));
    return source;
  }, [
    bins,
    pdfActiveOnly,
    pdfAreaCode,
    pdfRowFilter,
    pdfBayFilter,
    pdfLevelFilter,
    pdfBinFilter,
    pdfCreatedSince,
  ]);

  const pdfFiltersActive =
    pdfAreaFilter !== "__all__" ||
    pdfRowFilter !== "__all__" ||
    pdfBayFilter !== "__all__" ||
    pdfLevelFilter !== "__all__" ||
    pdfBinFilter !== "__all__" ||
    pdfCreatedSince.trim().length > 0;

  const clearPdfFilters = () => {
    setPdfAreaFilter("__all__");
    setPdfRowFilter("__all__");
    setPdfBayFilter("__all__");
    setPdfLevelFilter("__all__");
    setPdfBinFilter("__all__");
    setPdfCreatedSince("");
  };

  const [shelvingDialogOpen, setShelvingDialogOpen] = useState(false);
  const [shelvingArea, setShelvingArea] = useState<WarehouseAreaDoc | null>(null);
  const [rowEditOpen, setRowEditOpen] = useState(false);
  const [rowEditCode, setRowEditCode] = useState("");
  const [rowEditRefill, setRowEditRefill] = useState(false);

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

  const openShelving = (area: WarehouseAreaDoc) => {
    setShelvingArea(area);
    setShelvingDialogOpen(true);
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
      const { binsUpdated } = await updateWarehouseAreaWithBinSync(
        selected.id,
        editAreaId,
        selected.code,
        {
          code: editAreaCode,
          name: editAreaName,
          purposes: editAreaPurposes,
        }
      );
      toast({
        title: "Area updated",
        description:
          binsUpdated > 0 ? `${binsUpdated} bin path(s) updated to match the new area code.` : undefined,
      });
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

  const openEditBin = (bin: WarehouseBinDoc) => {
    setEditBinId(bin.id);
    setEditBinOpen(true);
  };

  const handleSaveEditBin = async (input: {
    area: string;
    row: string;
    bay: string;
    level: string;
    binCode: string;
    barcode: string;
    active: boolean;
    temporary: boolean;
  }) => {
    if (!selected || !editBinId) return;
    setSaving(true);
    try {
      await updateWarehouseBin(selected.id, editBinId, selected.code, input);
      toast({ title: "Bin updated" });
      setEditBinOpen(false);
      setEditBinId(null);
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

  const handleDeleteBin = async (binId: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      await deleteWarehouseBin(selected.id, binId);
      toast({ title: "Bin deleted" });
      if (editBinId === binId) {
        setEditBinOpen(false);
        setEditBinId(null);
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearAreaBins = async (area: WarehouseAreaDoc) => {
    if (!selected) return;
    setSaving(true);
    try {
      const removed = await clearWarehouseAreaBins(selected.id, area.code);
      toast({
        title: "Shelving cleared",
        description: `Removed ${removed} bin(s) from area ${area.code}. The area record is unchanged.`,
      });
      setShelvingDialogOpen(false);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Clear failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveShelvingRow = async (rowCode: string) => {
    if (!selected || !shelvingArea) return;
    setSaving(true);
    try {
      const removed = await deleteWarehouseBinsByAreaRow(selected.id, shelvingArea.code, rowCode);
      toast({
        title: "Row removed",
        description: `Deleted ${removed} bin(s) on row ${rowCode} in area ${shelvingArea.code}.`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Remove failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const openRowEdit = (rowCode: string, refill: boolean) => {
    setRowEditCode(rowCode);
    setRowEditRefill(refill);
    setRowEditOpen(true);
  };

  const handleSaveRowEdit = async (payload: RowRackSavePayload) => {
    if (!selected || !shelvingArea) return;
    const estimated = countBinSlotsInDetailedRack(
      payload.baysByRow,
      payload.levelsPerBay,
      payload.binsPerLevel
    );
    if (estimated > 25_000) {
      toast({
        variant: "destructive",
        title: "Too many bins",
        description: `This row would create about ${estimated.toLocaleString()} bins (limit 25,000).`,
      });
      return;
    }
    setSaving(true);
    try {
      const res = await replaceWarehouseAreaRow({
        warehouseId: selected.id,
        warehouseCode: selected.code,
        storageAreaId: shelvingArea.id,
        areaCode: shelvingArea.code,
        rowCode: payload.rowCode,
        rowCodes: [payload.rowCode],
        baysByRow: payload.baysByRow,
        levelsPerBay: payload.levelsPerBay,
        binsPerLevel: payload.binsPerLevel,
      });
      toast({
        title: rowEditRefill ? "Row refilled" : "Row updated",
        description: `Bins created ${res.created}, skipped ${res.skipped}${
          res.failed ? `, failed ${res.failed}` : ""
        }.`,
      });
      setRowEditOpen(false);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArea = async (area: WarehouseAreaDoc) => {
    if (!selected) return;
    setSaving(true);
    try {
      const { binsRemoved } = await deleteWarehouseAreaCascade(selected.id, area.id);
      toast({
        title: "Area deleted",
        description: `Removed area ${area.code} and ${binsRemoved} bin(s).`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Delete failed",
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
      ? buildRowCodesWithAssignment(existingRowsForRackTarget, rowCount, wizRowAssignMode)
      : buildRowCodes(rowCount);

  const gapRowCodesForExtend = useMemo(
    () => (rackWizardMode === "extend-area" ? listGapRowCodes(existingRowsForRackTarget) : []),
    [rackWizardMode, existingRowsForRackTarget]
  );

  const wizGridLayout = useMemo(() => {
    try {
      const rowCount = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
      if (wizBayCounts.length !== rowCount) return null;
      for (const m of wizBayCounts) {
        if (!Number.isFinite(m) || m < 1 || m > 99) return null;
      }
      const rowCodes =
        rackWizardMode === "extend-area"
          ? buildRowCodesWithAssignment(existingRowsForRackTarget, rowCount, wizRowAssignMode)
          : buildRowCodes(rowCount);
      const baysByRow = buildBaysPerRowFromCounts(rowCodes, wizBayCounts);
      return { rowCodes, baysByRow };
    } catch {
      return null;
    }
  }, [wizRowCountStr, wizBayCounts, rackWizardMode, existingRowsForRackTarget, wizRowAssignMode]);

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
          ? buildRowCodesWithAssignment(existingRowsForRackTarget, rowCount, wizRowAssignMode)
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
    wizRowAssignMode,
  ]);

  const wizRowLabels = useMemo(() => {
    try {
      const rc = parseBoundedInt(wizRowCountStr, "Row count", 1, 999);
      if (rackWizardMode === "extend-area") {
        return buildRowCodesWithAssignment(existingRowsForRackTarget, rc, wizRowAssignMode);
      }
      return buildRowCodes(rc);
    } catch {
      return [] as string[];
    }
  }, [wizRowCountStr, rackWizardMode, existingRowsForRackTarget, wizRowAssignMode]);

  const [printing, setPrinting] = useState(false);
  const [deletingWarehouse, setDeletingWarehouse] = useState(false);

  const resetCreateForm = () => {
    setNewCode("");
    setNewName("");
    setCodeTouched(false);
    setCodeSuggestionLabel("");
    setLocForm(emptyWarehouseLocationForm());
  };

  const warehouseCodeCandidates = useMemo(
    () =>
      warehouses.map((w) => ({
        code: w.code,
        stateOrProvince: w.stateOrProvince,
        country: w.country,
      })),
    [warehouses]
  );

  const suggestCodeForRegion = (
    country: string,
    stateOrProvince: string
  ): { code: string; label: string; sequence: number } | null => {
    if (!stateOrProvince.trim()) return null;
    try {
      return suggestNextWarehouseCode({
        country,
        stateOrProvince,
        existing: warehouseCodeCandidates,
      });
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!createOpen || codeTouched) return;
    const country = resolveCountryFromForm(locForm);
    const state = resolveStateFromForm(locForm);
    const suggestion = suggestCodeForRegion(country, state);
    if (!suggestion) return;
    setNewCode(suggestion.code);
    setCodeSuggestionLabel(suggestion.label);
    setLocForm((prev) => ({
      ...prev,
      locationName: prev.locationName.trim() ? prev.locationName : suggestion.label,
    }));
    setNewName((prev) =>
      prev.trim() ? prev : `${state} ${String(suggestion.sequence).padStart(2, "0")}`
    );
  }, [
    createOpen,
    codeTouched,
    locForm.selectedCountry,
    locForm.selectedStateOrProvince,
    locForm.newCountryName,
    locForm.newStateOrProvinceName,
    warehouseCodeCandidates,
  ]);

  const openCreateWarehouseDialog = () => {
    resetCreateForm();
    setLocForm({
      ...emptyWarehouseLocationForm(),
      selectedCountry: "United States",
      country: "United States",
    });
    setCreateOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setNewCode(selected.code);
    setNewName(selected.name);
    const linked = selected.linkedLocationId
      ? locations.find((l) => l.id === selected.linkedLocationId)
      : null;
    if (linked) {
      setLocForm(locationToFormValues(linked));
    } else {
      setLocForm({
        ...emptyWarehouseLocationForm(),
        locationName: selected.name,
        selectedCountry: selected.country || "",
        selectedStateOrProvince: selected.stateOrProvince || "",
        street1: selected.street1 || "",
        street2: selected.street2 || "",
        city: selected.city || "",
        zip: selected.zip || "",
      });
    }
    setEditOpen(true);
  };

  const handleCreateWarehouse = async () => {
    const locErr = validateWarehouseLocationForm(locForm);
    if (locErr) {
      toast({ variant: "destructive", title: "Address required", description: locErr });
      return;
    }
    const addr = warehouseLocationFormToPayload(locForm);
    let code = newCode.trim();
    if (!code) {
      const suggestion = suggestCodeForRegion(addr.country, addr.stateOrProvince);
      if (suggestion) code = suggestion.code;
    }
    if (!code || !isValidPathSegment(code)) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description: "Warehouse code must be alphanumeric (used in bin paths).",
      });
      return;
    }
    const addr = warehouseLocationFormToPayload(locForm);
    setSaving(true);
    try {
      const { warehouseId } = await createWarehouseWithLocation({
        code,
        name: newName.trim() || addr.name,
        locationName: addr.name,
        country: addr.country,
        stateOrProvince: addr.stateOrProvince,
        street1: addr.street1,
        street2: addr.street2,
        city: addr.city,
        zip: addr.zip,
      });
      toast({
        title: "Warehouse created",
        description: "Location and warehouse are linked. Add areas to design the layout.",
      });
      setCreateOpen(false);
      resetCreateForm();
      setSelectedOrphanId(null);
      setSelectedId(warehouseId);
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
    const locErr = validateWarehouseLocationForm(locForm);
    if (locErr) {
      toast({ variant: "destructive", title: "Address required", description: locErr });
      return;
    }
    const addr = warehouseLocationFormToPayload(locForm);
    setSaving(true);
    try {
      await updateWarehouseWithLocation(selected.id, {
        code: newCode.trim(),
        name: newName.trim() || addr.name,
        locationName: addr.name,
        country: addr.country,
        stateOrProvince: addr.stateOrProvince,
        street1: addr.street1,
        street2: addr.street2,
        city: addr.city,
        zip: addr.zip,
      });
      toast({ title: "Saved", description: "Warehouse and location updated." });
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

  const handleSetupOrphanWarehouse = async () => {
    if (!selectedOrphanId) return;
    const code = orphanSetupCode.trim();
    if (!code || !isValidPathSegment(code)) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description: "Enter an alphanumeric warehouse code for bin paths.",
      });
      return;
    }
    setSaving(true);
    try {
      const warehouseId = await createWarehouseFromExistingLocation(
        selectedOrphanId,
        code,
        orphanSetupName.trim() || undefined
      );
      toast({
        title: "Warehouse linked",
        description: "You can now add areas and shelving for this location.",
      });
      setSelectedOrphanId(null);
      setOrphanSetupCode("");
      setOrphanSetupName("");
      setSelectedId(warehouseId);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Setup failed",
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
    const source = pdfBinsForLabels;
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
        title: `${selected.name} (${selected.code}) - bin labels`,
        bins: source,
        binsForLevelContext: bins,
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

  const linkedLocationIds = useMemo(
    () => new Set(warehouses.map((w) => w.linkedLocationId).filter((id): id is string => Boolean(id))),
    [warehouses]
  );

  const orphanLocations = useMemo(
    () => activeLocations.filter((l) => !linkedLocationIds.has(l.id)),
    [activeLocations, linkedLocationIds]
  );

  const selectedOrphan = useMemo(
    () => (selectedOrphanId ? activeLocations.find((l) => l.id === selectedOrphanId) || null : null),
    [selectedOrphanId, activeLocations]
  );

  useEffect(() => {
    if (!selectedOrphan || orphanCodeTouched) return;
    const suggestion = suggestCodeForRegion(
      selectedOrphan.country || "United States",
      selectedOrphan.stateOrProvince || ""
    );
    if (!suggestion) return;
    setOrphanSetupCode(suggestion.code);
    setOrphanSetupName((prev) => (prev.trim() ? prev : selectedOrphan.name || suggestion.label));
  }, [selectedOrphan, orphanCodeTouched, warehouseCodeCandidates]);

  const selectWarehouse = (id: string) => {
    setSelectedId(id);
    setSelectedOrphanId(null);
  };

  const selectOrphanLocation = (locationId: string) => {
    setSelectedOrphanId(locationId);
    setSelectedId("");
    setOrphanCodeTouched(false);
    setOrphanSetupCode("");
    setOrphanSetupName("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Warehouse className="h-7 w-7 text-violet-600" />
            Warehouses &amp; bins
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Create each site here with its address — a matching location is created automatically for user assignment in
            Roles &amp; Permissions. Then design areas, shelving, and print bin labels. Existing locations without layout
            appear in the sidebar until you link them.
          </p>
        </div>
        <Button onClick={openCreateWarehouseDialog} className="shrink-0">
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
            ) : warehouses.length === 0 && orphanLocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No warehouses yet. Create one to begin.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {warehouses.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => selectWarehouse(w.id)}
                    className={`text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                      w.id === selectedId && !selectedOrphanId
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
                {orphanLocations.length > 0 ? (
                  <>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide pt-3 px-1">
                      Needs layout
                    </p>
                    {orphanLocations.map((loc) => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => selectOrphanLocation(loc.id)}
                        className={`text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                          selectedOrphanId === loc.id
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                            : "border-dashed border-muted-foreground/30 hover:bg-muted"
                        }`}
                      >
                        <div className="font-medium flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span className="truncate">{loc.name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {formatLocationPath(loc.country, loc.stateOrProvince, loc.name)}
                        </p>
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedOrphan ? (
          <Card>
            <CardHeader>
              <CardTitle>{selectedOrphan.name}</CardTitle>
              <CardDescription>
                This location exists for user assignment but has no warehouse layout yet. Add a bin-path code and start
                designing areas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <p className="text-sm text-muted-foreground">
                {formatLocationPath(
                  selectedOrphan.country,
                  selectedOrphan.stateOrProvince,
                  selectedOrphan.name
                )}
                <br />
                {[selectedOrphan.street1, selectedOrphan.street2, selectedOrphan.city, selectedOrphan.zip]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <div className="space-y-2">
                <Label>Warehouse code (bin paths)</Label>
                <Input
                  value={orphanSetupCode}
                  onChange={(e) => {
                    setOrphanCodeTouched(true);
                    setOrphanSetupCode(e.target.value.toUpperCase());
                  }}
                  placeholder="NJ03"
                />
                {orphanSetupCode ? (
                  <p className="text-xs text-muted-foreground">
                    Shown as {formatWarehouseCodeLabel(orphanSetupCode)} · used in barcodes as {orphanSetupCode}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Display name (optional)</Label>
                <Input
                  value={orphanSetupName}
                  onChange={(e) => setOrphanSetupName(e.target.value)}
                  placeholder={selectedOrphan.name}
                />
              </div>
              <Button onClick={handleSetupOrphanWarehouse} disabled={saving || !orphanSetupCode.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create warehouse & design layout"}
              </Button>
            </CardContent>
          </Card>
        ) : !selected ? (
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
                  <TabsTrigger value="labels">3 -+ Bin labels</TabsTrigger>
                  <TabsTrigger value="cartons">4 -+ Cartons</TabsTrigger>
                </TabsList>

                <TabsContent value="areas" className="space-y-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Design each area your way: pick one or more purposes (including custom labels), optionally add
                    shelving with per-row layout, and extend or add temporary shelves later. Labels can be printed for
                    the whole warehouse or filtered by area or row.
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
                          <TableHead className="min-w-[280px] text-right">Actions</TableHead>
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
                                      onClick={() => openShelving(a)}
                                    >
                                      <Plus className="h-3.5 w-3.5 mr-1" />
                                      Shelving
                                    </Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button type="button" variant="destructive" size="sm">
                                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                                          Delete
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Delete area {a.code}?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Removes the area and all {binCount} bin(s). Cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => void handleDeleteArea(a)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          >
                                            Delete area
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
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
                    Edit any bin path segment, barcode, or status. Use <strong className="text-foreground">Shelving</strong> on
                    an area to add rows or remove individual rows, or edit bins below.
                  </p>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-sm font-semibold text-foreground">Bin list</h3>
                      <p className="text-xs text-muted-foreground">
                        Showing {filteredBins.length.toLocaleString()} of {bins.length.toLocaleString()} bins
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 rounded-lg border p-4 bg-muted/30">
                      <div className="space-y-1 sm:col-span-2 lg:col-span-3 xl:col-span-2">
                        <Label className="text-xs text-muted-foreground">Search path</Label>
                        <Input placeholder="e.g. NJ01-A-03" value={binSearch} onChange={(e) => setBinSearch(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Area</Label>
                        <Select value={binFilterArea} onValueChange={(v) => { setBinFilterArea(v); setBinFilterRow("__all__"); setBinFilterBay("__all__"); setBinFilterLevel("__all__"); }}>
                          <SelectTrigger><SelectValue placeholder="All areas" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All areas</SelectItem>
                            {areas.map((a) => (<SelectItem key={a.id} value={a.code}>{a.code}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Row</Label>
                        <Select value={binFilterRow} onValueChange={(v) => { setBinFilterRow(v); setBinFilterBay("__all__"); setBinFilterLevel("__all__"); }} disabled={binFilterRowOptions.length === 0}>
                          <SelectTrigger><SelectValue placeholder="All rows" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All rows</SelectItem>
                            {binFilterRowOptions.map((row) => (<SelectItem key={row} value={row}>{row}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Bay</Label>
                        <Select value={binFilterBay} onValueChange={(v) => { setBinFilterBay(v); setBinFilterLevel("__all__"); }} disabled={binFilterBayOptions.length === 0}>
                          <SelectTrigger><SelectValue placeholder="All bays" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All bays</SelectItem>
                            {binFilterBayOptions.map((bay) => (<SelectItem key={bay} value={bay}>{bay}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Level</Label>
                        <Select value={binFilterLevel} onValueChange={setBinFilterLevel} disabled={binFilterLevelOptions.length === 0}>
                          <SelectTrigger><SelectValue placeholder="All levels" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All levels</SelectItem>
                            {binFilterLevelOptions.map((level) => (<SelectItem key={level} value={level}>{level}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Status</Label>
                        <Select value={binFilterActive} onValueChange={(v) => setBinFilterActive(v as "all" | "active" | "inactive")}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="active">Active only</SelectItem>
                            <SelectItem value="inactive">Inactive only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {binFiltersActive ? (<Button type="button" variant="outline" size="sm" onClick={clearBinFilters}>Clear filters</Button>) : null}
                    <div className="h-[min(60vh,560px)] min-h-[280px] rounded-md border mouse-both-scroll overscroll-contain">
                      <Table containerClassName="overflow-visible min-w-[720px]">
                        <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead className="w-16">Area</TableHead>
                          <TableHead className="w-14">Row</TableHead>
                          <TableHead className="w-14">Bay</TableHead>
                          <TableHead className="w-16">Level</TableHead>
                          <TableHead className="w-20 text-right">Active</TableHead>
                          <TableHead className="w-32 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {binsLoading ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-muted-foreground text-sm">
                              Loading bins…
                            </TableCell>
                          </TableRow>
                        ) : filteredBins.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-muted-foreground text-sm">
                              No bins match these filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredBins.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="font-mono text-xs max-w-[280px] truncate" title={b.path}>
                                {b.path}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.area}</TableCell>
                              <TableCell className="font-mono text-xs">{b.row}</TableCell>
                              <TableCell className="font-mono text-xs">{b.bay}</TableCell>
                              <TableCell className="font-mono text-xs">{b.level}</TableCell>
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
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => openEditBin(b)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Delete this bin?</AlertDialogTitle>
                                        <AlertDialogDescription className="font-mono text-xs break-all">
                                          {b.path}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => void handleDeleteBin(b.id)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          Delete bin
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
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
                    Choose exactly which bins get labels — by area, row, bay, level, or one specific bin. Leave filters on &quot;All&quot; to include everything (still respects active-only below).
                  </p>
                  {!bins.length ? (
                    <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                      No bins yet — add shelving in <strong>Areas</strong>, then return here.
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-foreground">
                      {pdfBinsForLabels.length.toLocaleString()} label{pdfBinsForLabels.length === 1 ? "" : "s"} will be generated
                    </p>
                    {pdfFiltersActive ? (
                      <Button type="button" variant="outline" size="sm" onClick={clearPdfFilters}>
                        Clear label filters
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 rounded-lg border p-4 bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Area</Label>
                      <Select value={pdfAreaFilter} onValueChange={(v) => { setPdfAreaFilter(v); setPdfRowFilter("__all__"); setPdfBayFilter("__all__"); setPdfLevelFilter("__all__"); setPdfBinFilter("__all__"); }}>
                        <SelectTrigger><SelectValue placeholder="All areas" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All areas</SelectItem>
                          {areas.map((a) => (<SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Row</Label>
                      <Select value={pdfRowFilter} onValueChange={(v) => { setPdfRowFilter(v); setPdfBayFilter("__all__"); setPdfLevelFilter("__all__"); setPdfBinFilter("__all__"); }} disabled={pdfRowOptions.length === 0}>
                        <SelectTrigger><SelectValue placeholder="All rows" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All rows</SelectItem>
                          {pdfRowOptions.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Bay</Label>
                      <Select value={pdfBayFilter} onValueChange={(v) => { setPdfBayFilter(v); setPdfLevelFilter("__all__"); setPdfBinFilter("__all__"); }} disabled={pdfBayOptions.length === 0}>
                        <SelectTrigger><SelectValue placeholder="All bays" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All bays</SelectItem>
                          {pdfBayOptions.map((bay) => (<SelectItem key={bay} value={bay}>{bay}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Level</Label>
                      <Select value={pdfLevelFilter} onValueChange={(v) => { setPdfLevelFilter(v); setPdfBinFilter("__all__"); }} disabled={pdfLevelOptions.length === 0}>
                        <SelectTrigger><SelectValue placeholder="All levels" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All levels</SelectItem>
                          {pdfLevelOptions.map((level) => (<SelectItem key={level} value={level}>{level}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 sm:col-span-2 lg:col-span-3 xl:col-span-2">
                      <Label className="text-xs text-muted-foreground">Bin (single path)</Label>
                      <Select value={pdfBinFilter} onValueChange={setPdfBinFilter} disabled={pdfBinOptions.length === 0}>
                        <SelectTrigger><SelectValue placeholder="All matching bins" /></SelectTrigger>
                        <SelectContent className="max-h-[min(50vh,320px)]">
                          <SelectItem value="__all__">All matching bins</SelectItem>
                          {pdfBinOptions.map((b) => (<SelectItem key={b.id} value={b.id} className="font-mono text-xs">{b.path}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 sm:col-span-2 lg:col-span-3 xl:col-span-2">
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
                    <Button onClick={handlePrintPdf} disabled={printing || !bins.length || pdfBinsForLabels.length === 0}>
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

                <TabsContent value="cartons" className="space-y-4 mt-4">
                  {selected ? (
                    <WarehouseCartonManagement warehouse={selected} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Select a warehouse first.</p>
                  )}
                </TabsContent>

              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New warehouse</DialogTitle>
            <DialogDescription>
              Creates the location (for user assignment) and warehouse (for layout and bin paths) together.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Warehouse code</Label>
                <Input
                  value={newCode}
                  onChange={(e) => {
                    setCodeTouched(true);
                    setNewCode(e.target.value.toUpperCase());
                  }}
                  placeholder="NJ03"
                />
                <p className="text-xs text-muted-foreground">
                  {codeSuggestionLabel
                    ? `Auto-suggested ${codeSuggestionLabel} for this state (stored as ${newCode || "—"} in bin paths). Edit if needed.`
                    : "Select a state to auto-generate the next code (e.g. NJ-03 after NJ-01 and NJ-02)."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Jersey 02" />
              </div>
            </div>
            <WarehouseLocationAddressFields
              values={locForm}
              onChange={setLocForm}
              existingLocations={activeLocations}
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateWarehouse} disabled={saving || !newCode.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create warehouse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit warehouse</DialogTitle>
            <DialogDescription>Updates warehouse code, display name, and linked location address.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Warehouse code</Label>
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
            </div>
            <WarehouseLocationAddressFields
              values={locForm}
              onChange={setLocForm}
              existingLocations={activeLocations}
              disabled={saving}
            />
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
                  ? "How many rows to add? Choose whether to refill empty row numbers first or continue after the highest row."
                  : "How many rack rows in this area?")}
              {wizStep === "bays" && "For each row, how many bays (positions along the aisle)?"}
              {wizStep === "rackLevels" && "For each bay, how many vertical levels (1, 2, 3… in the path)?"}
              {wizStep === "rackBins" && "For each level in each bay, how many bin slots (labeled B01, B02, …)?"}
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
                {rackWizardMode === "extend-area" ? (
                  <div className="space-y-2 pt-2">
                    <Label className="text-sm">Row numbering</Label>
                    <RadioGroup
                      value={wizRowAssignMode}
                      onValueChange={(v) => setWizRowAssignMode(v as RowAssignMode)}
                      className="space-y-2"
                    >
                      <div className="flex items-start gap-2 rounded-md border p-3">
                        <RadioGroupItem value="fill-gaps" id="row-assign-gaps" className="mt-0.5" />
                        <label htmlFor="row-assign-gaps" className="text-sm cursor-pointer space-y-0.5">
                          <span className="font-medium">Refill gaps first</span>
                          <p className="text-xs text-muted-foreground">
                            Use empty row numbers (e.g. 01, 02) before adding new rows after the highest.
                            {gapRowCodesForExtend.length > 0 ? (
                              <>
                                {" "}
                                Gaps: <span className="font-mono">{gapRowCodesForExtend.join(", ")}</span>
                              </>
                            ) : (
                              " No gaps right now — same as continue after highest."
                            )}
                          </p>
                        </label>
                      </div>
                      <div className="flex items-start gap-2 rounded-md border p-3">
                        <RadioGroupItem value="continue" id="row-assign-continue" className="mt-0.5" />
                        <label htmlFor="row-assign-continue" className="text-sm cursor-pointer space-y-0.5">
                          <span className="font-medium">Continue after highest row</span>
                          <p className="text-xs text-muted-foreground">
                            Always number after the current maximum (e.g. existing 03, 04 → next is 05).
                          </p>
                        </label>
                      </div>
                    </RadioGroup>
                    {wizRowLabels.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        New row codes: <span className="font-mono">{wizRowLabels.join(", ")}</span>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Rows are numbered 01, 02, … (width adjusts for large counts).
                  </p>
                )}
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
                  Slots use codes B01, B02, … within each level.
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

      <WarehouseShelvingDialog
        open={shelvingDialogOpen}
        onOpenChange={(open) => {
          setShelvingDialogOpen(open);
          if (!open) setShelvingArea(null);
        }}
        area={shelvingArea}
        warehouseCode={selected?.code ?? ""}
        bins={bins}
        saving={saving}
        onAddShelving={() => {
          if (shelvingArea) openExtendShelving(shelvingArea);
        }}
        onEditRow={(row) => openRowEdit(row, false)}
        onRefillRow={(row) => openRowEdit(row, true)}
        onRemoveRow={handleRemoveShelvingRow}
        onClearAll={() => {
          if (shelvingArea) void handleClearAreaBins(shelvingArea);
        }}
      />

      <WarehouseRowEditDialog
        open={rowEditOpen}
        onOpenChange={(open) => {
          setRowEditOpen(open);
          if (!open) setRowEditCode("");
        }}
        rowCode={rowEditCode}
        areaCode={shelvingArea?.code ?? ""}
        warehouseCode={selected?.code ?? ""}
        bins={bins}
        saving={saving}
        isRefill={rowEditRefill}
        onSave={handleSaveRowEdit}
      />

      <WarehouseBinEditDialog
        open={editBinOpen}
        onOpenChange={(open) => {
          setEditBinOpen(open);
          if (!open) setEditBinId(null);
        }}
        bin={editBin}
        areas={areas}
        saving={saving}
        onSave={handleSaveEditBin}
      />

      <Dialog open={editAreaOpen} onOpenChange={setEditAreaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit area</DialogTitle>
            <DialogDescription>
              Update code, name, and purposes. Changing the area code updates all bin paths. Use Shelving to add or
              remove rows.
            </DialogDescription>
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
