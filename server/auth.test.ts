import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_SESSION_TTL_MS, createAppSessionToken, getAppSessionToken, verifyAppCredentials, verifyAppSessionToken } from "./auth.ts";
import { createApp } from "./app.ts";

test("app sign-in credentials and signed session cookies", () => {
  const oldUsername = process.env.APP_USERNAME;
  const oldPassword = process.env.APP_PASSWORD;
  process.env.APP_USERNAME = "studio-user";
  process.env.APP_PASSWORD = "a-long-private-password";
  try {
    assert.equal(verifyAppCredentials("studio-user", "a-long-private-password"), true);
    assert.equal(verifyAppCredentials("studio-user", "wrong-password"), false);

    const token = createAppSessionToken(1_000);
    assert.equal(verifyAppSessionToken(token, 1_000 + APP_SESSION_TTL_MS - 1), true);
    assert.equal(verifyAppSessionToken(token, 1_000 + APP_SESSION_TTL_MS), false);
    assert.equal(verifyAppSessionToken(`${token.slice(0, -1)}x`, 1_000), false);
    assert.equal(getAppSessionToken(`other=value; ${"jsncrm_session"}=${token}`), token);
    assert.equal(getAppSessionToken("other=value"), undefined);

    process.env.APP_PASSWORD = "rotated-private-password";
    assert.equal(verifyAppSessionToken(token, 1_000), false);
  } finally {
    if (oldUsername === undefined) delete process.env.APP_USERNAME;
    else process.env.APP_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = oldPassword;
  }
});

test("sign-in API sets an HTTP-only session and protects business endpoints", async (t) => {
  const oldUsername = process.env.APP_USERNAME;
  const oldPassword = process.env.APP_PASSWORD;
  process.env.APP_USERNAME = "studio-user";
  process.env.APP_PASSWORD = "a-long-private-password";
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldUsername === undefined) delete process.env.APP_USERNAME;
    else process.env.APP_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = oldPassword;
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let sessionBefore: Response;
  try {
    sessionBefore = await fetch(`${baseUrl}/api/auth/session`);
  } catch {
    t.skip("Sign-in API integration requires local TCP access.");
    return;
  }
  assert.deepEqual(await sessionBefore.json(), { required: true, authenticated: false, username: null });
  const protectedBefore = await fetch(`${baseUrl}/api/email/config`);
  assert.equal(protectedBefore.status, 401);
  assert.equal(protectedBefore.headers.has("www-authenticate"), false);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "studio-user", password: "incorrect" }),
  });
  assert.equal(invalidLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "studio-user", password: "a-long-private-password" }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(";")[0];
  const protectedAfter = await fetch(`${baseUrl}/api/email/config`, { headers: { Cookie: cookie } });
  assert.equal(protectedAfter.status, 200);
});
