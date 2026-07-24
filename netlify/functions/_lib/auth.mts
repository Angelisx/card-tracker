import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ct_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function getSecret(): string {
  const secret = Netlify.env.get("SESSION_SECRET") || Netlify.env.get("SITE_PASSWORD") || "";
  if (!secret) throw new Error("SESSION_SECRET (or SITE_PASSWORD) env var is not set");
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createSessionCookie(): string {
  const expires = Date.now() + THIRTY_DAYS * 1000;
  const payload = `${expires}`;
  const sig = sign(payload);
  const token = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}

export function hasValidSession(req: Request): boolean {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (!safeEqual(sig, expected)) return false;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  return true;
}

export function checkPassword(candidate: string): boolean {
  const real = Netlify.env.get("SITE_PASSWORD") || "";
  if (!real) return false;
  return safeEqual(candidate, real);
}

export function hasValidApiToken(req: Request): boolean {
  const configured = Netlify.env.get("API_TOKEN") || "";
  if (!configured) return false;
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token") || "";
  const candidate = bearer || queryToken;
  if (!candidate) return false;
  return safeEqual(candidate, configured);
}

/** True if request is authenticated either as the logged-in browser user, or via API token. */
export function isAuthorized(req: Request): boolean {
  return hasValidSession(req) || hasValidApiToken(req);
}
