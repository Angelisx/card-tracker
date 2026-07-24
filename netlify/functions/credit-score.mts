import type { Config, Context } from "@netlify/functions";
import { isAuthorized } from "./_lib/auth.mts";
import { getCreditSnapshot, setCreditSnapshot } from "./_lib/store.mts";

export default async (req: Request, _context: Context) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "GET") {
    const snapshot = await getCreditSnapshot();
    return Response.json(snapshot);
  }

  // PUT is used by Claude (via API token) to push a fresh snapshot pulled from Credit Karma.
  if (req.method === "PUT") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body.scoreBand !== "string" || !Array.isArray(body.factors)) {
      return Response.json({ error: "Expected { scoreBand, factors }" }, { status: 400 });
    }
    const snapshot = await setCreditSnapshot(body.scoreBand, body.factors);
    return Response.json(snapshot);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/credit-score",
};
