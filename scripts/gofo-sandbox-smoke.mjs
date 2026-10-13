/**
 * GOFO sandbox smoke test.
 * Usage: node --env-file=.env.local scripts/gofo-sandbox-smoke.mjs
 *
 * Steps: verifyDelivery → costEstimation → create → getLabel → track → cancel
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

const baseUrl = (process.env.GOFO_API_BASE_URL || "").replace(/\/$/, "");
const username = process.env.GOFO_API_USERNAME || "";
const password = process.env.GOFO_API_PASSWORD || "";
const productCode = process.env.GOFO_PRODUCT_CODE || "GOFO Parcel Pickup";
const entryPort = process.env.GOFO_ENTRY_PORT || "EWR";

if (!baseUrl || !username || !password) {
  console.error("Missing GOFO_API_BASE_URL / GOFO_API_USERNAME / GOFO_API_PASSWORD");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

async function gofo(method, path, body) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return { httpStatus: res.status, raw: text.slice(0, 500) };
  }
  return { httpStatus: res.status, ...json };
}

function logStep(name, result) {
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(result, null, 2));
}

const shipper = {
  shipperName: "Prep Services FBA",
  shipperPhone: "13476613010",
  shipperCountry: "US",
  shipperState: "New Jersey",
  shipperCity: "Mount Laurel",
  shipperArea: "Mount Laurel",
  shipperStreet: "1700 Liberty Place",
  shipperCode: "08054",
  shipperEmail: "info@prepservicesfba.com",
};

const consignee = {
  consigneeName: "Test Receiver",
  consigneePhone: "2125550100",
  consigneeCountry: "US",
  consigneeState: "New York",
  consigneeCity: "New York",
  consigneeArea: "Manhattan",
  address1: "350 5th Ave",
  address2: "Suite 1",
  consigneeCode: "10118",
  consigneeEmail: "test@example.com",
  remarks: "PrepCorex sandbox test",
};

const orderGoods = {
  weight: 1,
  length: 20,
  width: 15,
  height: 10,
};

const orderItemList = [
  { itemNameEn: "Test product", itemNameZh: "Test", itemQty: 1 },
];

const cOrderNo = `PSF-SMOKE-${Date.now().toString().slice(-10)}`;

const orderPayload = {
  cOrderNo,
  referenceNo: cOrderNo,
  shippingType: "HDN",
  productCode,
  declaredValue: 10,
  entryPort,
  orderShipper: shipper,
  orderConsignee: consignee,
  orderGoods,
  orderItemList,
};

async function main() {
  console.log("GOFO sandbox smoke test");
  console.log({ baseUrl, username, productCode, entryPort, cOrderNo });

  // 1) Verify delivery ZIP
  const verify = await gofo("POST", "/open-api/v2/order/verifyDelivery", {
    orderConsignee: {
      consigneeCountry: "US",
      consigneeState: consignee.consigneeState,
      consigneeCity: consignee.consigneeCity,
      consigneeArea: consignee.consigneeArea,
      consigneeStreet: consignee.address1,
      consigneeCode: consignee.consigneeCode,
    },
  });
  logStep("1. verifyDelivery", verify);

  // 2) Cost estimation
  const rate = await gofo("POST", "/open-api/v2/order/costEstimation", orderPayload);
  logStep("2. costEstimation", rate);

  // 3) Create order
  const created = await gofo("POST", "/open-api/v2/order/create", orderPayload);
  logStep("3. create", created);

  const waybillNo =
    created?.data?.waybillNo ||
    created?.data?.cOrderNo ||
    cOrderNo;

  // 4) Label (only if create looked successful)
  if (Number(created?.code) === 200) {
    const label = await gofo(
      "GET",
      `/open-api/v2/order/getOrderLabelUrlV2?orderNo=${encodeURIComponent(waybillNo)}`
    );
    const b64 =
      label?.data?.base64code ||
      label?.data?.base64Code ||
      "";
    logStep("4. getOrderLabelUrlV2", {
      ...label,
      data: b64
        ? { base64Length: b64.length, base64Prefix: String(b64).slice(0, 40) + "…" }
        : label?.data,
    });

    const track = await gofo(
      "GET",
      `/open-api/v2/order/track/${encodeURIComponent(waybillNo)}`
    );
    logStep("5. track", track);

    const cancel = await gofo("POST", "/open-api/v2/order/cancel", {
      orderNo: waybillNo,
      remarks: "PrepCorex sandbox smoke cancel",
    });
    logStep("6. cancel", cancel);
  } else {
    console.log("\nSkipping label/track/cancel because create did not return code 200.");
    console.log("If auth failed (401), check username/password.");
    console.log("If params failed (301), ask GOFO for US shipper format + exact productCode.");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
