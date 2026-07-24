import type { Config, Context } from "@netlify/functions";
import { isAuthorized } from "./_lib/auth.mts";
import { getWallet, setWallet, fireWebhook } from "./_lib/store.mts";
import { allCards, cardById, bestCardPerCategory, allCategories } from "./_lib/cards.mts";

const TOOLS = [
  {
    name: "list_my_cards",
    description: "List the credit cards currently in the user's wallet, with their reward categories.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_all_cards",
    description: "List every credit card in the reference database (not just the ones the user owns).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "best_card_for_category",
    description: "Given a spending category, return which of the user's wallet cards earns the best reward rate.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: `One of: ${allCategories().join(", ")}`,
        },
      },
      required: ["category"],
    },
  },
  {
    name: "best_card_by_all_categories",
    description: "Return the best wallet card for every spending category at once.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_card_to_wallet",
    description: "Add a card (by its id from list_all_cards) to the user's wallet.",
    inputSchema: {
      type: "object",
      properties: { cardId: { type: "string" } },
      required: ["cardId"],
    },
  },
  {
    name: "remove_card_from_wallet",
    description: "Remove a card (by id) from the user's wallet.",
    inputSchema: {
      type: "object",
      properties: { cardId: { type: "string" } },
      required: ["cardId"],
    },
  },
];

async function callTool(name: string, args: any) {
  switch (name) {
    case "list_my_cards": {
      const wallet = await getWallet();
      const cards = wallet.cardIds.map(cardById).filter(Boolean).concat(wallet.customCards as any);
      return { cards, updatedAt: wallet.updatedAt };
    }
    case "list_all_cards":
      return { cards: allCards() };
    case "best_card_for_category": {
      const wallet = await getWallet();
      const rec = bestCardPerCategory(wallet.cardIds, wallet.customCards);
      const category = args?.category;
      if (!category || !(category in rec)) {
        return { error: `Unknown category. Valid categories: ${allCategories().join(", ")}` };
      }
      return { category, best: rec[category] };
    }
    case "best_card_by_all_categories": {
      const wallet = await getWallet();
      return { recommendations: bestCardPerCategory(wallet.cardIds, wallet.customCards) };
    }
    case "add_card_to_wallet": {
      const wallet = await getWallet();
      if (!cardById(args?.cardId)) return { error: "Unknown card id" };
      const cardIds = Array.from(new Set([...wallet.cardIds, args.cardId]));
      const updated = await setWallet({ cardIds, customCards: wallet.customCards });
      await fireWebhook(updated);
      return { ok: true, wallet: updated };
    }
    case "remove_card_from_wallet": {
      const wallet = await getWallet();
      const cardIds = wallet.cardIds.filter((id) => id !== args?.cardId);
      const updated = await setWallet({ cardIds, customCards: wallet.customCards });
      await fireWebhook(updated);
      return { ok: true, wallet: updated };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function rpcResult(id: any, result: any) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: any, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 200 });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({
      info: "This is a simplified MCP-style JSON-RPC endpoint (Streamable HTTP, no SSE). POST JSON-RPC 2.0 requests here with Authorization: Bearer <API_TOKEN> or ?token=<API_TOKEN>.",
      methods: ["initialize", "tools/list", "tools/call"],
    });
  }

  if (!isAuthorized(req)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body || {};

  try {
    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "card-tracker", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (method === "tools/list") {
      return rpcResult(id, { tools: TOOLS });
    }
    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(toolName, args);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  } catch (err: any) {
    return rpcError(id, -32000, err?.message || "Internal error");
  }
};

export const config: Config = {
  path: "/mcp",
};
