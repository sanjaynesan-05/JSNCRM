import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const APP_SESSION_COOKIE = "jsncrm_session";
export const APP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function hasAppAuthConfiguration() {
  return Boolean(process.env.APP_USERNAME || process.env.APP_PASSWORD);
}

export function appAuthIsConfigured() {
  return Boolean(process.env.APP_USERNAME && process.env.APP_PASSWORD);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string, username: string, password: string) {
  return createHmac("sha256", `${username}\0${password}`).update(payload).digest("base64url");
}

export function verifyAppCredentials(username: string, password: string) {
  const expectedUsername = process.env.APP_USERNAME || "";
  const expectedPassword = process.env.APP_PASSWORD || "";
  return appAuthIsConfigured() && safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

export function createAppSessionToken(now = Date.now()) {
  const username = process.env.APP_USERNAME || "";
  const password = process.env.APP_PASSWORD || "";
  if (!username || !password) throw new Error("APP_USERNAME and APP_PASSWORD are required to create a session.");
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: now + APP_SESSION_TTL_MS, nonce: randomBytes(16).toString("base64url") })).toString("base64url");
  return `${payload}.${sign(payload, username, password)}`;
}

export function verifyAppSessionToken(token: string | undefined, now = Date.now()) {
  if (!token || !appAuthIsConfigured()) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  const username = process.env.APP_USERNAME || "";
  const password = process.env.APP_PASSWORD || "";
  const expectedSignature = sign(payload, username, password);
  if (!safeEqual(signature, expectedSignature)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username?: unknown; expiresAt?: unknown; nonce?: unknown };
    return session.username === username && typeof session.expiresAt === "number" && session.expiresAt > now && typeof session.nonce === "string";
  } catch {
    return false;
  }
}

export function getAppSessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== APP_SESSION_COOKIE) continue;
    return entry.slice(separator + 1).trim();
  }
  return undefined;
}
