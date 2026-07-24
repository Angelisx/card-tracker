import type { Config, Context } from "@netlify/functions";
import { isAuthorized } from "./_lib/auth.mts";
import { getWallet } from "./_lib/store.mts";
import { allCards, cardById, bestCardPerCategory } from "./_lib/cards.mts";

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

export default async (req: Request, _context: Context) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized. Pass ?token=YOUR_API_TOKEN or Authorization: Bearer YOUR_API_TOKEN" }, { status: 401 });
  }

  const wallet = await getWallet();
  const myCards = wallet.cardIds.map(cardById).filter(Boolean).concat(wallet.customCards as any);
  const recommendations = bestCardPerCategory(wallet.cardIds, wallet.customCards);

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "json";

  if (format === "csv") {
    const rows = myCards.map((c: any) => ({
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      rewardType: c.rewardType,
      baseRate: c.baseRate,
      categories: (c.categories || []).map((cc: any) => `${cc.category}:${cc.rate}x`).join("; "),
    }));
    return new Response(toCsv(rows), {
      headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=my-cards.csv" },
    });
  }

  return Response.json({
    updatedAt: wallet.updatedAt,
    myCards,
    bestCardByCategory: recommendations,
    allCardsAvailable: allCards().length,
  });
};

export const config: Config = {
  path: "/api/export",
};
