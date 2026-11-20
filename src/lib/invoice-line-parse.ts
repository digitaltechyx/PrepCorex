/** Parse CRM-style line text that embeds ship date / SKU / pack into description. */

export type ParsedInvoiceLine = {
  productName: string;
  shipDate: string;
  sku: string;
  packaging: string;
};

/**
 * CRM descriptions often look like:
 * `Sayana Press · Ship date: 11/11/2026` or `… · Pack: Service · SKU: ABC`
 */
export function parseCrmStyleInvoiceLine(raw: string | null | undefined): ParsedInvoiceLine {
  const text = String(raw || "").trim();
  if (!text) {
    return { productName: "", shipDate: "", sku: "", packaging: "" };
  }

  const shipDates: string[] = [];
  let sku = "";
  let packaging = "";
  const productParts: string[] = [];

  for (const part of text.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean)) {
    const shipMatch = /^Ship\s*date:\s*(.+)$/i.exec(part);
    if (shipMatch) {
      const value = shipMatch[1].trim();
      if (value) shipDates.push(value);
      continue;
    }
    const skuMatch = /^SKU:\s*(.+)$/i.exec(part);
    if (skuMatch) {
      sku = skuMatch[1].trim();
      continue;
    }
    const packMatch = /^Pack(?:aging)?:\s*(.+)$/i.exec(part);
    if (packMatch) {
      packaging = packMatch[1].trim();
      continue;
    }
    productParts.push(part);
  }

  // Fallback: ship date embedded without middot separators
  if (shipDates.length === 0) {
    const inline = /Ship\s*date:\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i.exec(text);
    if (inline?.[1]) {
      shipDates.push(inline[1].trim());
      const cleaned = text.replace(inline[0], "").replace(/\s*·\s*/g, " · ").replace(/\s{2,}/g, " ").trim();
      return {
        productName: cleaned || text,
        shipDate: shipDates[0] || "",
        sku,
        packaging,
      };
    }
  }

  return {
    productName: productParts.join(" · ").trim() || text,
    // Prefer the first ship date from the CRM description (real ship date)
    shipDate: shipDates[0] || "",
    sku,
    packaging,
  };
}
