import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { APP_SESSION_COOKIE, APP_SESSION_TTL_MS, appAuthIsConfigured, createAppSessionToken, getAppSessionToken, hasAppAuthConfiguration, verifyAppCredentials, verifyAppSessionToken } from "./auth.ts";
import emailRoutes from "./routes/email.routes.ts";
import businessRoutes from "./routes/business.routes.ts";
import invoiceRoutes from "./routes/invoice.routes.ts";
import paymentRoutes, { webhookRouter } from "./routes/payment.routes.ts";

export function createApp() {
  const app = express();
  // Render's web service sits behind one trusted inbound proxy. Trust only that
  // hop so req.ip reflects the client without trusting arbitrary proxy chains.
  if (process.env.NODE_ENV === "production" || process.env.RENDER === "true") app.set("trust proxy", 1);
  const configuredClientUrl = process.env.CLIENT_URL?.trim();
  const renderUrl = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, "");
  const configuredUrlIsLocal = configuredClientUrl ? ["localhost", "127.0.0.1", "::1"].includes(new URL(configuredClientUrl).hostname.toLowerCase()) : false;
  const clientUrl = renderUrl && (!configuredClientUrl || configuredUrlIsLocal)
    ? renderUrl
    : configuredClientUrl || "http://localhost:5173";
  const allowedOrigins = new Set([clientUrl, ...(renderUrl ? [renderUrl] : []), ...(configuredClientUrl ? [configuredClientUrl] : [])]);
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).hostname.toLowerCase()).concat(["localhost", "127.0.0.1", "[::1]", "::1"]));
  app.use(helmet());
  app.use(
    cors({
      origin: [...allowedOrigins],
      allowedHeaders: ["Content-Type"],
      methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    }),
  );
  app.use((req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      const rawHost = req.get("host")?.toLowerCase() || "";
      const requestHost = rawHost.startsWith("[") ? rawHost.slice(1, rawHost.indexOf("]")) : rawHost.split(":")[0];
      const isSignedWebhookPath = req.path === "/api/webhooks/razorpay" && req.method === "POST";
      if (!isSignedWebhookPath && requestHost && !allowedHosts.has(requestHost))
        return res
          .status(403)
          .json({
            error: "Request host is not allowed.",
          });
      const origin = req.get("origin");
      if (!isSignedWebhookPath && origin && !allowedOrigins.has(origin))
        return res
          .status(403)
          .json({ error: "Request origin is not allowed." });
    }
    next();
  });
  app.use("/api/webhooks/razorpay", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }), express.raw({ type: "application/json", limit: "256kb" }), webhookRouter);
  app.use(express.json({ limit: "1mb" }));
  const apiRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path === "/healthz" || req.path === "/webhooks/razorpay",
  });
  const failedAuthenticationRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many failed authentication attempts. Please wait 15 minutes and try again." },
  });
  app.get("/api/health", (_request, response) =>
    response.json({ ok: true, service: "jsn-designs-business-studio" }),
  );
  app.get("/healthz", (_request, response) =>
    response.json({ ok: true, service: "jsn-designs-business-studio" }),
  );
  app.use("/api", apiRateLimit);
  app.get("/api/auth/session", (req, res) => {
    if (!hasAppAuthConfiguration()) return res.json({ required: false, authenticated: true, username: null });
    if (!appAuthIsConfigured()) return res.status(503).json({ error: "App sign-in is not configured correctly." });
    const authenticated = verifyAppSessionToken(getAppSessionToken(req.get("cookie")));
    return res.json({ required: true, authenticated, username: authenticated ? process.env.APP_USERNAME : null });
  });
  app.post("/api/auth/login", (req, res) => {
    if (!hasAppAuthConfiguration()) return res.status(409).json({ error: "App sign-in is not enabled." });
    if (!appAuthIsConfigured()) return res.status(503).json({ error: "App sign-in is not configured correctly." });
    const input = z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(1024) }).safeParse(req.body);
    if (!input.success || !verifyAppCredentials(input.data.username, input.data.password)) {
      return failedAuthenticationRateLimit(req, res, () => res.status(401).json({ error: "The username or password is incorrect." }));
    }
    res.cookie(APP_SESSION_COOKIE, createAppSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.RENDER === "true",
      sameSite: "strict",
      path: "/",
      maxAge: APP_SESSION_TTL_MS,
    });
    return res.json({ ok: true, username: process.env.APP_USERNAME });
  });
  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(APP_SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.RENDER === "true",
      sameSite: "strict",
      path: "/",
    });
    return res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (!hasAppAuthConfiguration()) return next();
    if (!appAuthIsConfigured()) return res.status(503).json({ error: "App sign-in is not configured correctly." });
    if (verifyAppSessionToken(getAppSessionToken(req.get("cookie")))) return next();
    return res.status(401).json({ error: "Your sign-in has expired. Please sign in again." });
  });
  app.use("/api/email", emailRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/invoices", paymentRoutes);
  app.use("/api", businessRoutes);
  const distPath = fileURLToPath(new URL("../dist/", import.meta.url));
  if (existsSync(join(distPath, "index.html"))) {
    app.use(express.static(distPath, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      return res.sendFile(join(distPath, "index.html"));
    });
  }
  return app;
}
