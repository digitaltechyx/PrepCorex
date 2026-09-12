import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { resolveLexiClient } from "@/lib/lexi/access";
import {
  lexiFindClients,
  lexiFindProducts,
  lexiGetInboundRequest,
} from "@/lib/lexi/read-tools";
import type {
  LexiInboundApprovePayload,
  LexiInboundCompletePayload,
  LexiInboundCreatePayload,
  LexiPendingAction,
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
      description: "Search a client's inventory products by name or SKU (for restock).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: { type: "string" },
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
          clientUserId: { type: "string" },
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
];

export type LexiToolRunResult = {
  toolResult: string;
  pendingAction?: LexiPendingAction;
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
      const results = await lexiFindProducts(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.query ?? "")
      );
      return { toolResult: JSON.stringify({ products: results }) };
    }
    case "get_inbound_request": {
      const result = await lexiGetInboundRequest(
        adminProfile,
        String(args.clientUserId ?? ""),
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ request: result }) };
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
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
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
      const client = await resolveLexiClient(
        adminProfile,
        String(args.clientUserId ?? ""),
        String(args.clientUserName ?? "")
      );
      const payload: LexiInboundCompletePayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        sku: String(args.sku),
        quantity: args.quantity != null ? Number(args.quantity) : undefined,
        binPath: args.binPath ? String(args.binPath) : undefined,
        useDefaultBin: args.useDefaultBin === true || !args.binPath,
        warehouseId: args.warehouseId ? String(args.warehouseId) : undefined,
      };
      const qtyLabel = payload.quantity != null ? `${payload.quantity} good units` : "remaining good units";
      const dest = payload.binPath ? `bin ${payload.binPath}` : "auto-resolved default bin";
      const summary = `Complete receive for #${payload.requestId} (${payload.productName}): ${qtyLabel} → ${dest}`;
      return {
        toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
        pendingAction: { id: randomUUID(), type: "inbound_complete", summary, payload },
      };
    }
    default:
      return { toolResult: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
