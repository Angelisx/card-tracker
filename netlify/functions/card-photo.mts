import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { hasValidSession, isAuthorized } from "./_lib/auth.mts";

const MAX_BYTES = 3 * 1024 * 1024; // 3MB

function photoStore() {
  return getStore("card-tracker-photos");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default async (req: Request, _context: Context) => {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = photoStore();
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");

  if (req.method === "GET") {
    if (!cardId) {
      // List mode: return which card ids have a stored photo.
      const { blobs } = await store.list();
      return Response.json({ cardIds: blobs.map((b) => b.key) });
    }
    const result = await store.getWithMetadata(cardId, { type: "arrayBuffer" });
    if (!result || !result.data) {
      return new Response("Not found", { status: 404 });
    }
    const contentType = (result.metadata?.contentType as string) || "image/jpeg";
    return new Response(result.data as ArrayBuffer, {
      headers: { "content-type": contentType, "cache-control": "private, max-age=3600" },
    });
  }

  // Mutations require a real browser session.
  if (!hasValidSession(req)) {
    return Response.json({ error: "Read-only with an API token. Log in to upload photos." }, { status: 403 });
  }

  if (req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { cardId: bodyCardId, dataUrl } = body;
    if (typeof bodyCardId !== "string" || typeof dataUrl !== "string") {
      return Response.json({ error: "Expected { cardId, dataUrl }" }, { status: 400 });
    }
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return Response.json({ error: "dataUrl must be a base64 image data URL" }, { status: 400 });
    }
    const [, contentType, base64] = match;
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength > MAX_BYTES) {
      return Response.json({ error: "Image too large (max 3MB after compression)" }, { status: 400 });
    }
    await store.set(bodyCardId, bytes, { metadata: { contentType } });
    return Response.json({ ok: true, cardId: bodyCardId });
  }

  if (req.method === "DELETE") {
    if (!cardId) {
      return Response.json({ error: "cardId query param required" }, { status: 400 });
    }
    await store.delete(cardId);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/card-photo",
};
