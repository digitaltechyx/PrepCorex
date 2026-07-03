/**
 * Generates inbound bulk import test CSV with mixed inventory types.
 * Usage: node scripts/generate-inbound-bulk-test-csv.mjs [rowCount] [outputPath]
 */
import { createWriteStream } from "fs";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HEADERS = [
  "Inventory Type",
  "Product Sub Type",
  "Entry Mode",
  "Product Name",
  "SKU",
  "Color",
  "Size",
  "Quantity",
  "Container Size",
  "Retail Identifier",
  "Expiry Date",
  "Remarks",
  "Tracking Number",
  "Carrier",
];

const COLORS = ["Red", "Blue", "Black", "White", "Green", "Navy", "Gray"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Amazon Logistics"];

function escapeCsv(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToLine(row) {
  return HEADERS.map((h) => escapeCsv(row[h] ?? "")).join(",");
}

function formatExpiryDate(year, month, day) {
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function makeRow(values) {
  const row = Object.fromEntries(HEADERS.map((h) => [h, ""]));
  Object.assign(row, values);
  return row;
}

const rowCount = Number.parseInt(process.argv[2] || "50000", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultOut = join(__dirname, "..", "test-data", `inbound-bulk-test-${rowCount}.csv`);
const outputPath = process.argv[3] || defaultOut;

mkdirSync(dirname(outputPath), { recursive: true });

const stream = createWriteStream(outputPath, { encoding: "utf8" });
stream.write("\uFEFF");
stream.write(HEADERS.join(",") + "\n");

// Mix weights (must sum to rowCount)
const buckets = [
  { type: "product-new-single", count: Math.floor(rowCount * 0.25) },
  { type: "product-new-variants", count: Math.floor(rowCount * 0.25) },
  { type: "product-restock", count: Math.floor(rowCount * 0.1) },
  { type: "box", count: Math.floor(rowCount * 0.15) },
  { type: "pallet", count: Math.floor(rowCount * 0.15) },
  { type: "container-20", count: Math.floor(rowCount * 0.075) },
  { type: "container-40", count: 0 },
];
buckets[buckets.length - 1].count =
  rowCount - buckets.slice(0, -1).reduce((sum, b) => sum + b.count, 0);

let seq = 0;
for (const bucket of buckets) {
  for (let i = 0; i < bucket.count; i++) {
    seq += 1;
    let row;

    switch (bucket.type) {
      case "product-new-single":
        row = makeRow({
          "Inventory Type": "product",
          "Product Sub Type": "new",
          "Entry Mode": "single",
          "Product Name": `Bulk Test Product ${seq}`,
          SKU: `BULK-SINGLE-${String(seq).padStart(6, "0")}`,
          Quantity: String((seq % 50) + 1),
          "Retail Identifier": seq % 7 === 0 ? `UPC-${100000000000 + seq}` : "",
          "Expiry Date": seq % 5 === 0 ? formatExpiryDate(2026, (seq % 12) + 1, 15) : "",
          Remarks: `New single product row ${seq}`,
          "Tracking Number": seq % 3 === 0 ? `9400111899${String(seq).padStart(10, "0")}` : "",
          Carrier: seq % 3 === 0 ? CARRIERS[seq % CARRIERS.length] : "",
        });
        break;

      case "product-new-variants": {
        const color = COLORS[seq % COLORS.length];
        const size = SIZES[seq % SIZES.length];
        const baseSku = `BULK-BASE-${String(seq).padStart(6, "0")}`;
        row = makeRow({
          "Inventory Type": "product",
          "Product Sub Type": "new",
          "Entry Mode": "variants",
          "Product Name": `Bulk Variant Parent ${Math.floor(seq / COLORS.length)}`,
          SKU: baseSku,
          Color: color,
          Size: size,
          Quantity: String((seq % 30) + 1),
          "Expiry Date": seq % 4 === 0 ? formatExpiryDate(2027, 6, 30) : "",
          Remarks: `Variant ${color} / ${size} row ${seq}`,
          "Tracking Number": seq % 4 === 0 ? `1Z999AA1${String(seq).padStart(10, "0")}` : "",
          Carrier: seq % 4 === 0 ? CARRIERS[seq % CARRIERS.length] : "",
        });
        break;
      }

      case "product-restock":
        row = makeRow({
          "Inventory Type": "product",
          "Product Sub Type": "restock",
          SKU: `RESTOCK-SKU-${String(seq).padStart(6, "0")}`,
          Quantity: String((seq % 100) + 1),
          Remarks: `Restock row ${seq} (needs matching inventory SKU to pass validation)`,
          "Tracking Number": seq % 2 === 0 ? `9274890${String(seq).padStart(7, "0")}` : "",
          Carrier: seq % 2 === 0 ? "USPS" : "",
        });
        break;

      case "box":
        row = makeRow({
          "Inventory Type": "box",
          Quantity: String((seq % 5) + 1),
          Remarks: `Box inbound row ${seq}`,
          "Tracking Number": seq % 3 === 0 ? `TBA${String(seq).padStart(12, "0")}` : "",
          Carrier: seq % 3 === 0 ? CARRIERS[seq % CARRIERS.length] : "",
        });
        break;

      case "pallet":
        row = makeRow({
          "Inventory Type": "pallet",
          Quantity: "1",
          Remarks: `Pallet inbound row ${seq}`,
          "Tracking Number": seq % 5 === 0 ? `PRO${String(seq).padStart(10, "0")}` : "",
          Carrier: seq % 5 === 0 ? "FedEx" : "",
        });
        break;

      case "container-20":
        row = makeRow({
          "Inventory Type": "container",
          Quantity: "1",
          "Container Size": "20 feet",
          Remarks: `20ft container row ${seq}`,
          "Tracking Number": seq % 2 === 0 ? `CONT20-${seq}` : "",
          Carrier: seq % 2 === 0 ? "Maersk" : "",
        });
        break;

      case "container-40":
        row = makeRow({
          "Inventory Type": "container",
          Quantity: "1",
          "Container Size": "40 feet",
          Remarks: `40ft container row ${seq}`,
          "Tracking Number": seq % 2 === 0 ? `CONT40-${seq}` : "",
          Carrier: seq % 2 === 0 ? "MSC" : "",
        });
        break;

      default:
        continue;
    }

    stream.write(rowToLine(row) + "\n");
  }
}

stream.end();
stream.on("finish", () => {
  console.log(`Wrote ${rowCount} rows to ${outputPath}`);
  console.log("Mix:");
  for (const b of buckets) {
    console.log(`  ${b.type}: ${b.count}`);
  }
});
