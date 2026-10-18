import ExcelJS from "exceljs";
import type { InventoryItem } from "@/types";
import {
  buildInventoryHistory,
  type InventoryHistoryRow,
  type InventoryHistorySources,
  type InventorySheetProductFields,
} from "@/lib/inventory-history";

const HISTORY_DROPDOWN_PROMPT = "Click ▼ to view history";

function colLetter(col1Based: number): string {
  let n = col1Based;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Compact one-line labels for Excel / Google Sheets dropdown lists. */
export function historyRowsToDropdownOptions(rows: InventoryHistoryRow[]): string[] {
  return rows.map((r) => {
    const change =
      r.qtyChange == null
        ? ""
        : r.qtyChange > 0
          ? `+${r.qtyChange}`
          : String(r.qtyChange);
    const details = String(r.details ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const line = [
      `${r.seq}. ${r.dateLabel} ${r.timeLabel}`,
      r.event,
      change || null,
      details || null,
    ]
      .filter(Boolean)
      .join(" · ");
    // Excel list items get awkward past ~250 chars
    return line.length > 240 ? `${line.slice(0, 237)}…` : line;
  });
}

function fullHistoryNote(rows: InventoryHistoryRow[]): string {
  if (rows.length === 0) return "No history";
  return rows
    .map((r) => {
      const change =
        r.qtyChange == null
          ? ""
          : r.qtyChange > 0
            ? `+${r.qtyChange}`
            : String(r.qtyChange);
      return [
        `${r.seq}. ${r.dateLabel} ${r.timeLabel} · ${r.event}${change ? ` (${change})` : ""}`,
        r.details ? `   ${r.details}` : "",
        r.user ? `   By: ${r.user}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/**
 * Excel workbook: one row per product; History column has a dropdown of every
 * history event (data validation). Helper sheet holds the list values.
 * Opens in Excel and Google Sheets with a real ▼ dropdown (not CSV).
 */
export async function buildInventoryHistoryWorkbook(input: {
  products: Array<{ item: InventoryItem; fields: InventorySheetProductFields }>;
  sources: InventoryHistorySources;
  sheetName?: string;
}): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PrepCorex";
  workbook.created = new Date();

  const inventory = workbook.addWorksheet(input.sheetName || "Inventory", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const lists = workbook.addWorksheet("HistoryLists");
  lists.state = "hidden";

  inventory.columns = [
    { header: "Product Name", key: "productName", width: 36 },
    { header: "SKU", key: "sku", width: 28 },
    { header: "Quantity", key: "quantity", width: 10 },
    { header: "Status", key: "status", width: 12 },
    { header: "Expiry Lots", key: "expiryLots", width: 28 },
    { header: "Date Added", key: "dateAdded", width: 20 },
    { header: "History", key: "history", width: 48 },
  ];

  const headerRow = inventory.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  input.products.forEach((product, index) => {
    const excelRow = index + 2;
    const listCol = index + 1;
    const letter = colLetter(listCol);

    const history = buildInventoryHistory(product.item, input.sources, {
      includeInternalEvents: false,
    }).filter((r) => r.eventType !== "transfer");
    const options = historyRowsToDropdownOptions(history);

    options.forEach((opt, optIndex) => {
      lists.getCell(optIndex + 1, listCol).value = opt;
    });

    const row = inventory.getRow(excelRow);
    row.values = [
      product.fields.productName,
      product.fields.sku,
      product.fields.quantity,
      product.fields.status,
      product.fields.expiryLots,
      product.fields.dateAdded,
      options.length > 0 ? HISTORY_DROPDOWN_PROMPT : "No history",
    ];
    row.alignment = { vertical: "top", wrapText: false };

    const historyCell = inventory.getCell(excelRow, 7);
    historyCell.note = fullHistoryNote(history);

    if (options.length > 0) {
      historyCell.dataValidation = {
        type: "list",
        allowBlank: true,
        showErrorMessage: false,
        showInputMessage: true,
        promptTitle: "History",
        prompt: "Open the dropdown to browse every stock event for this product.",
        formulae: [`HistoryLists!$${letter}$1:$${letter}$${options.length}`],
      };
    }
  });

  return workbook.xlsx.writeBuffer();
}

export function downloadExcelBuffer(
  buffer: ExcelJS.Buffer | ArrayBuffer | Uint8Array,
  filename: string
): void {
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
