import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { resolveLexiClient, resolveLexiClientForInbound } from "@/lib/lexi/access";
import { lexiGenerateReport } from "@/lib/lexi/generate-report";
import {
  lexiFindProducts,
  lexiGetInboundRequest,
  lexiGetOutboundRequest,
  lexiListPending,
  lexiLookupClientRecords,
  lexiLookupOutboundBilling,
} from "@/lib/lexi/read-tools";
import { prepareLexiOutboundCreate } from "@/lib/lexi/outbound-create-server";
import type {
  LexiCancelPayload,
  LexiInboundCreatePayload,
  LexiInboundUpdatePayload,
  LexiPendingAction,
  LexiReportAttachment,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

const uidProp = {
  type: "string" as const,
  description: "Always the signed-in client's Firebase uid",
};

export const LEXI_CLIENT_OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "find_products",
      description: "Search this client's inventory by name or SKU (read-only).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          query: { type: "string" },
        },
        required: ["clientUserId", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inbound_request",
      description: "Get this client's inbound request by id or product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_outbound_request",
      description: "Get this client's outbound request by id or product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_requests",
      description: "List this client's pending requests awaiting PrepCorex approval.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_client_records",
      description:
        "Read-only lookup of this client's profile, inventory, invoices, shipped, restock history, returns, or purchased shipping labels (Buy Labels). Use topic labels for label purchase counts/status — never send the client to Invoices for labels.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          topic: {
            type: "string",
            enum: [
              "profile",
              "inventory",
              "invoices",
              "shipped",
              "restock_history",
              "returns",
              "labels",
            ],
          },
          query: { type: "string" },
        },
        required: ["clientUserId", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_outbound_billing",
      description: "Read-only: whether this account uses PrepCorex invoices or CRM draft billing.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description:
        "Generate a CSV report for THIS client only (read-only, no Confirm). Prefer inventory, inbound, outbound, invoices-related overview.",
      parameters: {
        type: "object",
        properties: {
          reportType: {
            type: "string",
            enum: [
              "overview",
              "inbound",
              "outbound",
              "returns",
              "dispose",
              "inventory",
              "financial",
              "operations",
            ],
          },
          period: {
            type: "string",
            enum: ["today", "last_7_days", "last_30_days", "this_month", "last_month", "this_year", "all_time"],
          },
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["reportType", "clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_create",
      description:
        "Propose creating a pending product inbound for this client (requires Confirm). Collect required fields first, then ask optional expiry, UPC/retail id, tracking, unit size/weight. Photos and box/pallet/container: guide to Inventory → Inbound Shipment.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          productName: { type: "string" },
          sku: { type: "string", description: "Optional — can add later from Inventory" },
          quantity: { type: "number" },
          productSubType: { type: "string", enum: ["new", "restock"] },
          productId: { type: "string", description: "Required for restock — from find_products" },
          remarks: { type: "string" },
          retailIdentifier: { type: "string", description: "Optional UPC / EAN / FNSKU / ASIN" },
          expiryDate: {
            type: "string",
            description: "Optional lot/shelf expiry YYYY-MM-DD (ask when product has shelf life)",
          },
          trackingNumber: { type: "string" },
          carrier: { type: "string" },
          unitLengthIn: { type: "number" },
          unitWidthIn: { type: "number" },
          unitHeightIn: { type: "number" },
          unitWeightLb: { type: "number" },
        },
        required: ["clientUserId", "clientUserName", "productName", "quantity", "productSubType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_update",
      description:
        "Propose updating a PENDING inbound request (requires Confirm). Use this when the client wants to change fields (unit size/weight, expiry, SKU, qty, retail id, remarks, product name). Do NOT tell them to cancel and recreate. Look up the request first. Only pass fields that should change.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string", description: "Current product name for Confirm summary" },
          productNameNew: { type: "string", description: "New product name when renaming" },
          sku: { type: "string" },
          quantity: { type: "number" },
          retailIdentifier: { type: "string" },
          expiryDate: { type: "string", description: "YYYY-MM-DD or empty to clear" },
          remarks: { type: "string" },
          unitLengthIn: { type: "number" },
          unitWidthIn: { type: "number" },
          unitHeightIn: { type: "number" },
          unitWeightLb: { type: "number" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_cancel",
      description: "Propose cancelling a pending inbound request (requires Confirm + reason).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_create",
      description:
        "Propose creating a pending outbound request for this client (requires Confirm). Ask for service and box/pallet unless provided.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          service: { type: "string" },
          shipmentPreference: { type: "string", enum: ["box", "pallet"] },
          productType: { type: "string" },
          shipTo: { type: "string" },
          remarks: { type: "string" },
          fbaLabelWorkflow: { type: "boolean" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                productName: { type: "string" },
                sku: { type: "string" },
                quantity: { type: "number" },
                packOf: { type: "number" },
              },
              required: ["productId", "productName", "quantity", "packOf"],
            },
          },
        },
        required: ["clientUserId", "clientUserName", "service", "shipmentPreference", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_cancel",
      description: "Propose cancelling a pending outbound request and restoring stock (requires Confirm + reason).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "reason"],
      },
    },
  },
];

function pending(
  type: LexiPendingAction["type"],
  summary: string,
  payload: LexiPendingAction["payload"]
): { toolResult: string; pendingAction: LexiPendingAction } {
  return {
    toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
    pendingAction: { id: randomUUID(), type, summary, payload },
  };
}

/** Force every tool call onto the signed-in client uid. */
export function forceLexiClientSelfArgs(
  args: Record<string, unknown>,
  client: UserProfile
): Record<string, unknown> {
  return {
    ...args,
    clientUserId: client.uid,
    clientUserName: String(client.name || client.email || client.uid),
  };
}

export async function runLexiClientTool(
  clientProfile: UserProfile,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<{
  toolResult: string;
  pendingAction?: LexiPendingAction;
  report?: LexiReportAttachment;
}> {
  const args = forceLexiClientSelfArgs(rawArgs, clientProfile);
  const selfUid = String(clientProfile.uid);
  const selfName = String(clientProfile.name || clientProfile.email || selfUid);

  switch (name) {
    case "find_products": {
      const results = await lexiFindProducts(clientProfile, selfUid, String(args.query ?? ""));
      return { toolResult: JSON.stringify({ clientUserId: selfUid, products: results }) };
    }
    case "get_inbound_request": {
      const client = await resolveLexiClientForInbound(clientProfile, {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId: args.requestId ? String(args.requestId) : undefined,
      });
      if (client.uid !== selfUid) {
        return { toolResult: JSON.stringify({ error: "You can only view your own inbound requests." }) };
      }
      const result = await lexiGetInboundRequest(
        clientProfile,
        selfUid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: selfUid, request: result }) };
    }
    case "get_outbound_request": {
      const result = await lexiGetOutboundRequest(
        clientProfile,
        selfUid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: selfUid, request: result }) };
    }
    case "list_pending_requests": {
      const pendingLists = await lexiListPending(clientProfile, selfUid);
      return {
        toolResult: JSON.stringify({
          ...pendingLists,
          clientUserId: selfUid,
          clientUserName: selfName,
        }),
      };
    }
    case "lookup_client_records": {
      const records = await lexiLookupClientRecords(
        clientProfile,
        selfUid,
        String(args.topic ?? "profile"),
        args.query ? String(args.query) : undefined
      );
      return {
        toolResult: JSON.stringify({ clientUserId: selfUid, clientUserName: selfName, records }),
      };
    }
    case "lookup_outbound_billing": {
      const billing = await lexiLookupOutboundBilling(clientProfile, selfUid);
      return { toolResult: JSON.stringify(billing) };
    }
    case "generate_report": {
      try {
        const generated = await lexiGenerateReport(clientProfile, {
          reportType: String(args.reportType ?? "inventory"),
          period: args.period ? String(args.period) : undefined,
          clientUserId: selfUid,
          clientUserName: selfName,
        });
        return { toolResult: JSON.stringify(generated.summary), report: generated.report };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate that report.";
        return { toolResult: JSON.stringify({ error: message }) };
      }
    }
    case "propose_inbound_create": {
      await resolveLexiClient(clientProfile, selfUid, selfName);
      const productSubType = args.productSubType === "restock" ? "restock" : "new";
      if (productSubType === "restock" && !String(args.productId || "").trim()) {
        return {
          toolResult: JSON.stringify({
            error: "Restock requires productId from find_products before proposing.",
          }),
        };
      }
      const payload: LexiInboundCreatePayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        productName: String(args.productName),
        sku: args.sku ? String(args.sku) : undefined,
        quantity: Number(args.quantity),
        productSubType,
        productId: args.productId ? String(args.productId) : undefined,
        remarks: args.remarks ? String(args.remarks) : undefined,
        retailIdentifier: args.retailIdentifier ? String(args.retailIdentifier) : undefined,
        expiryDate: args.expiryDate ? String(args.expiryDate) : undefined,
        trackingNumber: args.trackingNumber ? String(args.trackingNumber) : undefined,
        carrier: args.carrier ? String(args.carrier) : undefined,
        unitLengthIn: args.unitLengthIn != null ? Number(args.unitLengthIn) : undefined,
        unitWidthIn: args.unitWidthIn != null ? Number(args.unitWidthIn) : undefined,
        unitHeightIn: args.unitHeightIn != null ? Number(args.unitHeightIn) : undefined,
        unitWeightLb: args.unitWeightLb != null ? Number(args.unitWeightLb) : undefined,
      };
      const extras = [
        payload.sku ? `SKU ${payload.sku}` : null,
        payload.expiryDate ? `expiry ${payload.expiryDate}` : null,
        payload.retailIdentifier ? `retail ${payload.retailIdentifier}` : null,
        payload.trackingNumber ? `tracking ${payload.trackingNumber}` : null,
      ].filter(Boolean);
      return pending(
        "inbound_create",
        `Create inbound: ${payload.quantity} × ${payload.productName} (${payload.productSubType}${extras.length ? ` · ${extras.join(" · ")}` : ""})`,
        payload
      );
    }
    case "propose_inbound_update": {
      const requestId = String(args.requestId ?? "").trim();
      const request = await lexiGetInboundRequest(clientProfile, selfUid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Inbound #${requestId} not found.` }) };
      }
      if (String(request.status ?? "").toLowerCase() !== "pending") {
        return {
          toolResult: JSON.stringify({
            error: `Inbound #${requestId} is "${request.status}" — only pending requests can be updated.`,
          }),
        };
      }
      const payload: LexiInboundUpdatePayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId,
        productName: String(args.productName || request.productName || ""),
        productNameNew: args.productNameNew != null ? String(args.productNameNew) : undefined,
        sku: args.sku !== undefined ? String(args.sku) : undefined,
        quantity: args.quantity != null ? Number(args.quantity) : undefined,
        retailIdentifier:
          args.retailIdentifier !== undefined ? String(args.retailIdentifier) : undefined,
        expiryDate: args.expiryDate !== undefined ? String(args.expiryDate) : undefined,
        remarks: args.remarks !== undefined ? String(args.remarks) : undefined,
        unitLengthIn: args.unitLengthIn != null ? Number(args.unitLengthIn) : undefined,
        unitWidthIn: args.unitWidthIn != null ? Number(args.unitWidthIn) : undefined,
        unitHeightIn: args.unitHeightIn != null ? Number(args.unitHeightIn) : undefined,
        unitWeightLb: args.unitWeightLb != null ? Number(args.unitWeightLb) : undefined,
      };
      const changeBits = [
        payload.productNameNew ? `name → ${payload.productNameNew}` : null,
        payload.sku !== undefined ? (payload.sku ? `SKU ${payload.sku}` : "SKU clear") : null,
        payload.quantity != null ? `qty ${payload.quantity}` : null,
        payload.expiryDate !== undefined
          ? payload.expiryDate
            ? `expiry ${payload.expiryDate}`
            : "expiry clear"
          : null,
        payload.retailIdentifier !== undefined
          ? payload.retailIdentifier
            ? `retail ${payload.retailIdentifier}`
            : "retail clear"
          : null,
        payload.unitLengthIn != null ||
        payload.unitWidthIn != null ||
        payload.unitHeightIn != null ||
        payload.unitWeightLb != null
          ? `unit ${[payload.unitLengthIn, payload.unitWidthIn, payload.unitHeightIn]
              .filter((n) => n != null)
              .join("×")}${payload.unitWeightLb != null ? ` ${payload.unitWeightLb}lb` : ""}`
          : null,
        payload.remarks !== undefined ? "remarks" : null,
      ].filter(Boolean);
      if (changeBits.length === 0) {
        return {
          toolResult: JSON.stringify({
            error:
              "Pass at least one field to change (e.g. unitLengthIn, unitWidthIn, unitHeightIn, unitWeightLb).",
          }),
        };
      }
      return pending(
        "inbound_update",
        `Update pending inbound #${requestId} (${payload.productName}): ${changeBits.join(" · ")}`,
        payload
      );
    }
    case "propose_inbound_cancel": {
      const requestId = String(args.requestId ?? "").trim();
      const request = await lexiGetInboundRequest(clientProfile, selfUid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Inbound #${requestId} not found.` }) };
      }
      if (String(request.status ?? "").toLowerCase() !== "pending") {
        return {
          toolResult: JSON.stringify({
            error: `Inbound #${requestId} is "${request.status}" — only pending requests can be cancelled.`,
          }),
        };
      }
      const reason = String(args.reason ?? "").trim();
      if (reason.length < 3) {
        return { toolResult: JSON.stringify({ error: "Cancellation reason is required." }) };
      }
      const payload: LexiCancelPayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId,
        productName: String(args.productName || request.productName || ""),
        reason,
      };
      return pending(
        "inbound_cancel",
        `Cancel inbound #${requestId} (${payload.productName}): ${reason}`,
        payload
      );
    }
    case "propose_outbound_create": {
      const rawLines = Array.isArray(args.lines) ? args.lines : [];
      const linesInput = rawLines.map((row: Record<string, unknown>) => ({
        productId: String(row.productId ?? ""),
        productName: String(row.productName ?? ""),
        sku: row.sku ? String(row.sku) : undefined,
        quantity: Number(row.quantity),
        packOf: row.packOf != null ? Number(row.packOf) : 1,
      }));
      try {
        const payload = await prepareLexiOutboundCreate({
          clientUserId: selfUid,
          clientUserName: selfName,
          service: String(args.service ?? ""),
          shipmentPreference: String(args.shipmentPreference ?? ""),
          productType: args.productType ? String(args.productType) : undefined,
          shipTo: args.shipTo ? String(args.shipTo) : undefined,
          remarks: args.remarks ? String(args.remarks) : undefined,
          lines: linesInput,
        });
        const totalUnits = payload.lines.reduce(
          (sum, line) => sum + line.quantity * line.packOf,
          0
        );
        const totalPrice = payload.lines.reduce((sum, line) => sum + line.totalPrice, 0);
        const lineText = payload.lines
          .map((line) => `${line.quantity}×pack${line.packOf} ${line.productName}`)
          .join("; ");
        const summary = `Create outbound: ${lineText}. ${totalUnits} units · $${totalPrice.toFixed(2)} · ${payload.service} · ${payload.shipmentPreference}`;
        return pending("outbound_create", summary, payload);
      } catch (error) {
        return {
          toolResult: JSON.stringify({
            error: error instanceof Error ? error.message : "Could not prepare outbound.",
          }),
        };
      }
    }
    case "propose_outbound_cancel": {
      const requestId = String(args.requestId ?? "").trim();
      const request = await lexiGetOutboundRequest(clientProfile, selfUid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Outbound #${requestId} not found.` }) };
      }
      const status = String(request.status ?? "").toLowerCase();
      if (status !== "pending" && status !== "awaiting_label_upload") {
        return {
          toolResult: JSON.stringify({
            error: `Outbound #${requestId} is "${request.status}" — only pending requests can be cancelled.`,
          }),
        };
      }
      const reason = String(args.reason ?? "").trim();
      if (reason.length < 3) {
        return { toolResult: JSON.stringify({ error: "Cancellation reason is required." }) };
      }
      const payload: LexiCancelPayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId,
        productName: String(args.productName || request.productName || ""),
        reason,
      };
      return pending(
        "outbound_cancel",
        `Cancel outbound #${requestId} (${payload.productName}): ${reason}`,
        payload
      );
    }
    default:
      return {
        toolResult: JSON.stringify({
          error: `Tool "${name}" is not available in client Lexi. Ask PrepCorex admin for help if needed.`,
        }),
      };
  }
}
