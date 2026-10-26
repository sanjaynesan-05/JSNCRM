import "dotenv/config";
import { isIP } from "node:net";
import { createApp } from "./app.ts";
import { initializeDatabase } from "./db/database.ts";
import { isConfigured } from "./services/mail.service.ts";

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || "127.0.0.1";
const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase();
const loopback = normalizedHost === "::1" || (isIP(normalizedHost) === 4 && normalizedHost.startsWith("127."));
if (!loopback) {
  throw new Error("HOST must be a loopback address (127.0.0.1 or ::1). This local application has no sign-in or network access controls.");
}
const database = initializeDatabase();
const app = createApp();

app.listen(port, host, () => {
  const databasePath = process.env.DATABASE_PATH || "default local app data";
  const migrationCount = (
    database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number }
  ).count;
  const componentStatus = [
    ["Vite frontend", "ready at http://localhost:5173"],
    ["Express API", `listening at http://${host}:${port}`],
    ["SQLite database", `${migrationCount} migrations applied (${databasePath})`],
    ["Security middleware", "Helmet, CORS, host checks, and rate limiting enabled"],
    ["Business workspace routes", "clients, projects, tasks, dashboard, and profile ready"],
    ["Quotation routes", "quotation workflow, status changes, duplication, and PDF export ready"],
    ["Invoice routes", "invoices, payments, reversals, and backups ready"],
    ["Email studio", isConfigured ? "Gmail SMTP configured" : "available; Gmail SMTP not configured"],
    ["Health check", `GET http://${host}:${port}/api/health`],
  ] as const;

  console.log("\nJSN Designs Business Studio is ready");
  console.log("-----------------------------------");
  for (const [component, status] of componentStatus) {
    console.log(`[OK] ${component}: ${status}`);
  }
  console.log("-----------------------------------\n");
});
