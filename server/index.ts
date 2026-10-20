import "dotenv/config";
import { isIP } from "node:net";
import { createApp } from "./app.ts";
import { initializeDatabase } from "./db/database.ts";

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || "127.0.0.1";
const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase();
const loopback = normalizedHost === "::1" || (isIP(normalizedHost) === 4 && normalizedHost.startsWith("127."));
if (!loopback) {
  throw new Error("HOST must be a loopback address (127.0.0.1 or ::1). This local application has no sign-in or network access controls.");
}
initializeDatabase();
createApp().listen(port, host, () =>
  console.log(
    `JSN Designs Business Studio API listening on http://${host}:${port}`,
  ),
);
