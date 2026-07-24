import type { Config, Context } from "@netlify/functions";
import { hasValidSession } from "./_lib/auth.mts";
import { getSettings, setSettings } from "./_lib/store.mts";

export default async (req: Request, _context: Context) => {
  if (!hasValidSession(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "GET") {
    const settings = await getSettings();
    return Response.json(settings);
  }

  if (req.method === "PUT") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim() ? body.webhookUrl.trim() : null;
    const settings = await setSettings(webhookUrl);
    return Response.json(settings);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/settings",
};
