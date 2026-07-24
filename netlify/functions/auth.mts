import type { Config, Context } from "@netlify/functions";
import { checkPassword, createSessionCookie, clearSessionCookie, hasValidSession } from "./_lib/auth.mts";

export default async (req: Request, _context: Context) => {
  if (req.method === "GET") {
    return Response.json({ authenticated: hasValidSession(req) });
  }

  if (req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // ignore
    }
    if (typeof body.password !== "string" || !checkPassword(body.password)) {
      return Response.json({ error: "Incorrect password" }, { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": createSessionCookie(),
      },
    });
  }

  if (req.method === "DELETE") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": clearSessionCookie(),
      },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/auth",
};
