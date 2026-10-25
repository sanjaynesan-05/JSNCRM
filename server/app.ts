import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import emailRoutes from "./routes/email.routes.ts";
import businessRoutes from "./routes/business.routes.ts";
import invoiceRoutes from "./routes/invoice.routes.ts";
import paymentRoutes, { webhookRouter } from "./routes/payment.routes.ts";

export function createApp() {
  const app = express();
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
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
      const host = rawHost.startsWith("[") ? rawHost.slice(1, rawHost.indexOf("]")) : rawHost.split(":")[0];
      const isSignedWebhookPath = req.path === "/api/webhooks/razorpay" && req.method === "POST";
      if (!isSignedWebhookPath && host && !["127.0.0.1", "localhost", "::1"].includes(host))
        return res
          .status(403)
          .json({
            error: "This local service only accepts loopback Host values.",
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
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", (_request, response) =>
    response.json({ ok: true, service: "jsn-designs-business-studio" }),
  );
  app.use("/api/email", emailRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/invoices", paymentRoutes);
  app.use("/api", businessRoutes);
  return app;
}
