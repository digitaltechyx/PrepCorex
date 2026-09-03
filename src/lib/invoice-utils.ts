/**
 * Shared helpers for invoice generation logic (client + server)
 */

/**
 * Turn an API response body into a short user-facing error string.
 */
export function parseApiErrorMessage(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as {
        error?: unknown;
        message?: unknown;
        details?: unknown;
      };
      if (typeof json.error === "string" && json.error.trim()) {
        const base = json.error.trim();
        if (typeof json.details === "string" && json.details.trim()) {
          return `${base} ${json.details.trim()}`;
        }
        return base;
      }
      if (typeof json.message === "string" && json.message.trim()) {
        return json.message.trim();
      }
    } catch {
      // fall through
    }
  }

  if (/^<!DOCTYPE html|^<html/i.test(trimmed)) {
    return `${fallback} The server returned an HTML error page — check SMTP/API env vars on the host.`;
  }

  if (trimmed.length > 320) return `${trimmed.slice(0, 320)}…`;
  return trimmed;
}

export async function readFetchError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  const base = fallback || `Request failed (HTTP ${response.status}).`;
  const parsed = parseApiErrorMessage(text, base);
  if (parsed === base && response.status) {
    return `${parsed} (HTTP ${response.status})`;
  }
  return parsed;
}

/**
 * Generate a unique invoice number based on current timestamp.
 * Example: INV-20251121-123
 */
export function generateInvoiceNumber(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `INV-${year}${month}${day}-${Date.now().toString().slice(-3)}`;
}




