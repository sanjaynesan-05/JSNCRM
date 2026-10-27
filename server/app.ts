import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import emailRoutes from "./routes/email.routes.ts";
import businessRoutes from "./routes/business.routes.ts";
import invoiceRoutes from "./routes/invoice.routes.ts";
import paymentRoutes, { webhookRouter } from "./routes/payment.routes.ts";

export function createApp() {
  const app = express();
  // Render's web service sits behind one trusted inbound proxy. Trust only that
  // hop so req.ip reflects the client without trusting arbitrary proxy chains.
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const appUsername = process.env.APP_USERNAME;
  const appPassword = process.env.APP_PASSWORD;
  const allowedHosts = new Set([new URL(clientUrl).hostname.toLowerCase(), "localhost", "127.0.0.1", "[::1]", "::1"]);
  app.use(helmet());
  app.use(
    cors({
      origin: clientUrl,
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
      if (!isSignedWebhookPath && origin && origin !== clientUrl)
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
    message: "Too many failed authentication attempts. Please wait 15 minutes and try again.",
  });
  app.get("/api/health", (_request, response) =>
    response.json({ ok: true, service: "jsn-designs-business-studio" }),
  );
  app.get("/healthz", (_request, response) =>
    response.json({ ok: true, service: "jsn-designs-business-studio" }),
  );
  app.use("/api", apiRateLimit);
  app.use((req, res, next) => {
    const isPublicEndpoint = req.path === "/api/health" || req.path === "/healthz" || req.path === "/api/webhooks/razorpay";
    if (isPublicEndpoint || (!appUsername && !appPassword)) return next();
    const authorization = req.get("authorization") || "";
    const encoded = authorization.match(/^Basic\s+(.+)$/i)?.[1];
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        if (separator > 0) {
          const username = Buffer.from(decoded.slice(0, separator));
          const password = Buffer.from(decoded.slice(separator + 1));
          const expectedUsername = Buffer.from(appUsername || "");
          const expectedPassword = Buffer.from(appPassword || "");
          const usernameMatches = username.length === expectedUsername.length && timingSafeEqual(username, expectedUsername);
          const passwordMatches = password.length === expectedPassword.length && timingSafeEqual(password, expectedPassword);
          if (usernameMatches && passwordMatches) return next();
        }
      } catch { /* Malformed credentials are rejected below. */ }
    }
    return failedAuthenticationRateLimit(req, res, () => {
      res.set("WWW-Authenticate", 'Basic realm="JSNCRM", charset="UTF-8"');
      res.status(401).send("Authentication required.");
    });
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
