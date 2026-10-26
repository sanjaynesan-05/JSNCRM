import "dotenv/config";
import { isIP } from "node:net";
import { createApp } from "./app.ts";
import { initializeDatabase } from "./db/database.ts";
import { razorpayConfiguration } from "./services/razorpay.service.ts";

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase();
const loopback = normalizedHost === "::1" || (isIP(normalizedHost) === 4 && normalizedHost.startsWith("127."));
const networkHost = normalizedHost === "0.0.0.0" || normalizedHost === "::";
if (!loopback && !networkHost) throw new Error("HOST must be a loopback address locally or 0.0.0.0/:: for a hosted deployment.");
if (process.env.NODE_ENV === "production" && (!process.env.APP_USERNAME || (process.env.APP_PASSWORD || "").length < 16)) {
  throw new Error("Production requires APP_USERNAME and an APP_PASSWORD of at least 16 characters.");
}
initializeDatabase();
const paymentConfig = razorpayConfiguration();
if (!paymentConfig.configured) console.warn(`Razorpay payments are disabled: ${paymentConfig.problem}`);
if (!process.env.RAZORPAY_WEBHOOK_SECRET) console.warn("Razorpay webhook processing is disabled until RAZORPAY_WEBHOOK_SECRET is configured.");
createApp().listen(port, host, () =>
  console.log(
    `JSN Designs Business Studio API listening on http://${host}:${port}`,
  ),
);
