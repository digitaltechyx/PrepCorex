/** Quick probe: try ZIPs + entryPorts against GOFO sandbox */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(resolve(process.cwd(), ".env.local"));

const baseUrl = process.env.GOFO_API_BASE_URL.replace(/\/$/, "");
const auth = `Basic ${Buffer.from(
  `${process.env.GOFO_API_USERNAME}:${process.env.GOFO_API_PASSWORD}`
).toString("base64")}`;

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

const zips = ["90210", "82006", "10001", "08054", "07001", "13626"];
console.log("--- verifyDelivery ZIPs ---");
for (const zip of zips) {
  const r = await post("/open-api/v2/order/verifyDelivery", {
    orderConsignee: {
      consigneeCountry: "US",
      consigneeState: "New York",
      consigneeCity: "Test",
      consigneeCode: zip,
    },
  });
  console.log(zip, r.code, r.msgEn || r.msg, r.data || "");
}

const ports = ["EWR", "PHX", "JFK", "LAX", "ORD", "IAH", "DFW", "SEA", "SFO", "ATL", "MCO", "MIA"];
const productCodes = ["GOFO Parcel Pickup", "GOFO Ground Pickup", "key-code-01", "EXP"];

const basePayload = {
  cOrderNo: `PROBE-${Date.now()}`,
  declaredValue: 10,
  shippingType: "HDN",
  orderShipper: {
    shipperName: "Prep Services FBA",
    shipperPhone: "13476613010",
    shipperCountry: "US",
    shipperState: "New Jersey",
    shipperCity: "Mount Laurel",
    shipperStreet: "1700 Liberty Place",
    shipperCode: "08054",
  },
  orderConsignee: {
    consigneeName: "Margaret Brown",
    consigneePhone: "2526051196",
    consigneeCountry: "US",
    consigneeState: "Wyoming",
    consigneeCity: "Cheyenne",
    address1: "1313 Test St",
    consigneeCode: "82006",
  },
  orderGoods: { weight: 1, length: 12, width: 10, height: 6 },
  orderItemList: [{ itemNameEn: "Toys", itemNameZh: "Toys", itemQty: 1 }],
};

console.log("\n--- costEstimation entryPort x productCode (sample) ---");
for (const entryPort of ["PHX", "EWR", "LAX"]) {
  for (const productCode of productCodes) {
    const r = await post("/open-api/v2/order/costEstimation", {
      ...basePayload,
      entryPort,
      productCode,
    });
    console.log(
      entryPort,
      "|",
      productCode,
      "=>",
      r.code,
      r.msgEn || r.msg,
      r.data ? JSON.stringify(r.data) : ""
    );
  }
}

console.log("\n--- create with PHX + first product that rated ok (if any) ---");
const create = await post("/open-api/v2/order/create", {
  ...basePayload,
  entryPort: "PHX",
  productCode: "GOFO Parcel Pickup",
});
console.log(JSON.stringify(create, null, 2));
