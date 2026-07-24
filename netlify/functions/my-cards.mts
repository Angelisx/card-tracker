import type { Config, Context } from "@netlify/functions";
import { hasValidSession, isAuthorized } from "./_lib/auth.mts";
import { getWallet, setWallet, fireWebhook } from "./_lib/store.mts";
import { allCards } from "./_lib/cards.mts";

export default async (req: Request, _context: Context) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "GET") {
    const wallet = await getWallet();
    return Response.json(wallet);
  }

  // Mutations require a real browser session, not just an API token.
  if (!hasValidSession(req)) {
    return Response.json({ error: "Read-only with an API token. Log in to modify your wallet." }, { status: 403 });
  }

  if (req.method === "PUT") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const cardIds: string[] = Array.isArray(body.cardIds) ? body.cardIds : [];
    const customCards: any[] = Array.isArray(body.customCards) ? body.customCards : [];
    const validIds = new Set(allCards().map((c) => c.id));
    const filtered = cardIds.filter((id) => validIds.has(id));
    const wallet = await setWallet({ cardIds: filtered, customCards });
    await fireWebhook(wallet);
    return Response.json(wallet);
  }

  if (req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const current = await getWallet();
    if (body.action === "add" && typeof body.cardId === "string") {
      const validIds = new Set(allCards().map((c) => c.id));
      if (!validIds.has(body.cardId)) {
        return Response.json({ error: "Unknown card id" }, { status: 400 });
      }
      const cardIds = Array.from(new Set([...current.cardIds, body.cardId]));
      const wallet = await setWallet({ cardIds, customCards: current.customCards });
      await fireWebhook(wallet);
      return Response.json(wallet);
    }
    if (body.action === "remove" && typeof body.cardId === "string") {
      const cardIds = current.cardIds.filter((id) => id !== body.cardId);
      const wallet = await setWallet({ cardIds, customCards: current.customCards });
      await fireWebhook(wallet);
      return Response.json(wallet);
    }
    if (body.action === "add_custom" && body.card) {
      const customCards = [...current.customCards, body.card];
      const wallet = await setWallet({ cardIds: current.cardIds, customCards });
      await fireWebhook(wallet);
      return Response.json(wallet);
    }
    if (body.action === "remove_custom" && typeof body.cardId === "string") {
      const customCards = current.customCards.filter((c: any) => c.id !== body.cardId);
      const wallet = await setWallet({ cardIds: current.cardIds, customCards });
      await fireWebhook(wallet);
      return Response.json(wallet);
    }
    return Response.json({ error: "Unrecognized action" }, { status: 400 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/my-cards",
};
