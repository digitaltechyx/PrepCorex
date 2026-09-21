import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { LEXI_EXTRA_TOOLS, runLexiExtraTool } from "@/lib/lexi/extra-tools";
import { resolveLexiClient, resolveLexiClientForInbound } from "@/lib/lexi/access";
import {
  lexiFindClients,
  lexiFindProducts,
  lexiGetInboundRequest,
  lexiGetOutboundRequest,
} from "@/lib/lexi/read-tools";
import { prepareLexiOutboundCreate } from "@/lib/lexi/outbound-create-server";
import type {
  LexiInboundApprovePayload,
  LexiInboundCompletePayload,
  LexiInboundCreatePayload,
  LexiOutboundApprovePayload,
  LexiOutboundCreatePayload,
  LexiPendingAction,
  LexiReportAttachment,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

export const LEXI_OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "find_clients",
      description: "Search clients the admin can manage by name or email.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or email fragment" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_products",
      description: "Search a client's inventory products by name or SKU (read-only).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
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
      description: "Get inbound request status by id or latest matching product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
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
      name: "propose_inbound_create",
      description: "Propose creating a pending product inbound request (requires admin confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
          clientUserName: { type: "string" },
          productName: { type: "string" },
          sku: { type: "string" },
          quantity: { type: "number" },
          productSubType: { type: "string", enum: ["new", "restock"] },
          productId: { type: "string" },
          remarks: { type: "string" },
        },
        required: [
          "clientUserId",
          "clientUserName",
          "productName",
          "sku",
          "quantity",
          "productSubType",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_approve",
      description: "Propose approving a pending inbound request (requires admin confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_complete",
      description:
        "Propose receive + putaway to complete an approved open inbound (requires admin confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          sku: { type: "string" },
          quantity: { type: "number" },
          binPath: { type: "string" },
          useDefaultBin: { type: "boolean" },
          warehouseId: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "sku"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_outbound_request",
      description: "Get outbound shipment request status by id or latest matching product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
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
      name: "propose_outbound_create",
      description:
        "Propose creating a pending product outbound request (requires admin confirmation). ALWAYS ask admin for service (FBA/WFS/TFS vs DTC/FBM) and shipmentPreference (box vs pallet) unless they already provided them. Supports multiple lines in one request, including the same product with different pack sizes (e.g. 5 pack of 2 and 10 pack of 3). Uses client pricing tariff — never $0.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
          clientUserName: { type: "string" },
          service: {
            type: "string",
            enum: ["FBA/WFS/TFS", "DTC/FBM"],
            description: "FBA/WFS/TFS = marketplace prep. DTC/FBM = merchant fulfilled.",
          },
          shipmentPreference: {
            type: "string",
            enum: ["box", "pallet"],
            description: "box = small parcel (SPD). pallet = LTL.",
          },
          productType: {
            type: "string",
            enum: ["Standard", "Custom"],
            description: "Default Standard unless admin says Custom.",
          },
          shipTo: { type: "string", description: "Optional ship-to / destination note." },
          remarks: { type: "string" },
          lines: {
            type: "array",
            description: "One or more product lines. Same product may appear multiple times with different packOf.",
            items: {
              type: "object",
              properties: {
                productId: { type: "string", description: "From find_products" },
                productName: { type: "string" },
                sku: { type: "string" },
                quantity: { type: "number", description: "Number of packs/boxes on this line" },
                packOf: { type: "number", description: "Units per pack (default 1)" },
              },
              required: ["productId", "productName", "quantity"],
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
      name: "propose_outbound_approve",
      description:
        "Propose approving a pending outbound request so it goes to warehouse pick (requires admin confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: {
            type: "string",
            description: "Exact Firebase uid from find_clients — never a display name",
          },
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "quantity"],
      },
    },
  },
  ...LEXI_EXTRA_TOOLS,
];

export type LexiToolRunResult = {
  toolResult: string;
  pendingAction?: LexiPendingAction;
  report?: LexiReportAttachment;
  pendingQueue?: import("@/lib/lexi/types").LexiPendingProcessingQueue;
};

export async function runLexiTool(
  adminProfile: UserProfile,
  name: string,
  args: Record<string, unknown>
): Promise<LexiToolRunResult> {
  switch (name) {
    case "find_clients": {
      const results = await lexiFindClients(adminProfile, String(args.query ?? ""));
      return { toolResult: JSON.stringify({ clients: results }) };
    }
    case "find_products": {
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const results = await lexiFindProducts(adminProfile, client.uid, String(args.query ?? ""));
      return { toolResult: JSON.stringify({ clientUserId: client.uid, products: results }) };
    }
    case "get_inbound_request": {
      const client = await resolveLexiClientForInbound(adminProfile, {
        clientUserId: String(args.clientUserId ?? ""),
        clientUserName: String(args.clientUserName ?? ""),
        requestId: args.requestId ? String(args.requestId) : undefined,
      });
      const result = await lexiGetInboundRequest(
        adminProfile,
        client.uid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: client.uid, request: result }) };
    }
    case "get_outbound_request": {
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const result = await lexiGetOutboundRequest(
        adminProfile,
        client.uid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: client.uid, request: result }) };
    }
    case "propose_inbound_create": {
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const payload: LexiInboundCreatePayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        productName: String(args.productName),
        sku: String(args.sku),
        quantity: Number(args.quantity),
        productSubType: args.productSubType === "restock" ? "restock" : "new",
        productId: args.productId ? String(args.productId) : undefined,
        remarks: args.remarks ? String(args.remarks) : undefined,
      };
      const summary = `Create inbound for ${payload.clientUserName}: ${payload.quantity} units of ${payload.productName} (SKU ${payload.sku}, ${payload.productSubType})`;
      return {
        toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
        pendingAction: { id: randomUUID(), type: "inbound_create", summary, payload },
      };
    }
    case "propose_inbound_approve": {
      const client = await resolveLexiClientForInbound(adminProfile, {
        clientUserId: String(args.clientUserId ?? ""),
        clientUserName: String(args.clientUserName ?? ""),
        requestId: String(args.requestId ?? ""),
      });
      const payload: LexiInboundApprovePayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        quantity: Number(args.quantity),
      };
      const summary = `Approve inbound #${payload.requestId} for ${payload.clientUserName}: ${payload.productName} (${payload.quantity} units)`;
      return {
        toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
        pendingAction: { id: randomUUID(), type: "inbound_approve", summary, payload },
      };
    }
    case "propose_inbound_complete": {
      const requestId = String(args.requestId ?? "").trim();
      const client = await resolveLexiClientForInbound(adminProfile, {
        clientUserId: String(args.clientUserId ?? ""),
        clientUserName: String(args.clientUserName ?? ""),
        requestId,
      });
      const request = await lexiGetInboundRequest(adminProfile, client.uid, requestId);
      if (!request) {
        return {
          toolResult: JSON.stringify({
            error: `Inbound request #${requestId} not found for ${client.name}.`,
          }),
        };
      }
      const status = String(request.status ?? "").trim().toLowerCase();
      if (status !== "approved") {
        return {
          toolResult: JSON.stringify({
            error: `Request #${requestId} is "${request.status}" — not approved yet. Approve first and wait for Confirm success, then complete receive. clientUserId=${client.uid}`,
            clientUserId: client.uid,
            requestId,
            status: request.status,
          }),
        };
      }
      const fulfillment = String(request.fulfillmentStatus ?? "").trim().toLowerCase();
      if (fulfillment && fulfillment !== "open") {
        return {
          toolResult: JSON.stringify({
            error: `Request #${requestId} fulfillment is "${request.fulfillmentStatus}" — only open approved inbounds can be received.`,
            clientUserId: client.uid,
            requestId,
          }),
        };
      }
      const payload: LexiInboundCompletePayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId,
        productName: String(args.productName || request.productName || ""),
        sku: String(args.sku || request.sku || ""),
        quantity:
          args.quantity != null
            ? Number(args.quantity)
            : Number(request.remainingToReceive) > 0
              ? Number(request.remainingToReceive)
              : undefined,
        binPath: args.binPath ? String(args.binPath) : undefined,
        useDefaultBin: args.useDefaultBin === true || !args.binPath,
        warehouseId: args.warehouseId ? String(args.warehouseId) : undefined,
      };
      const qtyLabel = payload.quantity != null ? `${payload.quantity} good units` : "remaining good units";
      const dest = payload.binPath
        ? `bin ${payload.binPath}`
        : "default warehouse bin (auto: prior SKU bin, else first compatible bin)";
      const summary = `Complete receive for #${payload.requestId} (${payload.productName}): ${qtyLabel} → ${dest}`;
      return {
        toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
        pendingAction: { id: randomUUID(), type: "inbound_complete", summary, payload },
      };
    }
    case "propose_outbound_create": {
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const rawLines = Array.isArray(args.lines) ? args.lines : [];
      const linesInput =
        rawLines.length > 0
          ? rawLines.map((row: Record<string, unknown>) => ({
              productId: String(row.productId ?? ""),
              productName: String(row.productName ?? ""),
              sku: row.sku ? String(row.sku) : undefined,
              quantity: Number(row.quantity),
              packOf: row.packOf != null ? Number(row.packOf) : 1,
            }))
          : args.productId
            ? [
                {
                  productId: String(args.productId),
                  productName: String(args.productName ?? ""),
                  sku: args.sku ? String(args.sku) : undefined,
                  quantity: Number(args.quantity),
                  packOf: args.packOf != null ? Number(args.packOf) : 1,
                },
              ]
            : [];

      try {
        const payload = await prepareLexiOutboundCreate({
          clientUserId: client.uid,
          clientUserName: client.name,
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
        const summary = `Create outbound for ${payload.clientUserName}: ${lineText}. ${totalUnits} units · $${totalPrice.toFixed(2)} · ${payload.service} · ${payload.shipmentPreference}${payload.fbaLabelWorkflow ? " · FBA workflow" : ""}`;
        return {
          toolResult: JSON.stringify({
            proposed: true,
            summary,
            clientUserId: client.uid,
            awaitingConfirmation: true,
          }),
          pendingAction: { id: randomUUID(), type: "outbound_create", summary, payload },
        };
      } catch (error) {
        return {
          toolResult: JSON.stringify({
            error: error instanceof Error ? error.message : "Could not prepare outbound.",
          }),
        };
      }
    }
    case "propose_outbound_approve": {
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const payload: LexiOutboundApprovePayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        quantity: Number(args.quantity),
      };
      const summary = `Approve outbound #${payload.requestId} for ${payload.clientUserName}: ${payload.productName} (${payload.quantity} units) — send to warehouse pick`;
      return {
        toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
        pendingAction: { id: randomUUID(), type: "outbound_approve", summary, payload },
      };
    }
    default: {
      const extra = await runLexiExtraTool(adminProfile, name, args);
      if (extra) return extra;
      return { toolResult: JSON.stringify({ error: `Unknown tool: ${name}` }) };
    }
  }
}
