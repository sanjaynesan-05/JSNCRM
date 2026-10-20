import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = InstanceType<typeof Database>;
const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));
const readMigrations = () => readdirSync(migrationsDir)
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));
let current: Db | undefined;
let currentPath: string | undefined;
export function openDatabase(
  file = process.env.DATABASE_PATH ||
    join(
      process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
      "JSN Designs Business Studio",
      "business.sqlite",
    ),
) {
  if (file !== ":memory:")
    mkdirSync(
      file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"))),
      { recursive: true },
    );
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((r) => r.version),
  );
  const migrations = readMigrations();
  for (const name of migrations) {
    const version = Number(name.slice(0, 3));
    if (applied.has(version)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(migrationsDir, name), "utf8"));
      db.prepare(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      ).run(version, new Date().toISOString());
    })();
  }
  const integrity = db.pragma("integrity_check") as {
    integrity_check: string;
  }[];
  if (integrity[0]?.integrity_check !== "ok") {
    db.close();
    throw new Error("SQLite integrity check failed during initialization.");
  }
  if (
    !(db.pragma("foreign_keys") as { foreign_keys: number }[])[0]?.foreign_keys
  ) {
    db.close();
    throw new Error("SQLite foreign key enforcement could not be enabled.");
  }
  if ((db.pragma("foreign_key_check") as unknown[]).length > 0) {
    db.close();
    throw new Error(
      "SQLite foreign-key integrity check failed during initialization.",
    );
  }
  return db;
}
export function initializeDatabase() {
  if (!current) {
    currentPath =
      process.env.DATABASE_PATH ||
      join(
        process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
        "JSN Designs Business Studio",
        "business.sqlite",
      );
    current = openDatabase(currentPath);
  }
  return current;
}
export function getDatabase(): Db {
  return current ?? initializeDatabase();
}
export function restoreDatabase(backupPath: string) {
  if (!currentPath || currentPath === ":memory:")
    throw new Error("Restore is unavailable for an in-memory database.");
  const target = currentPath,
    candidate = `${target}.restore-${Date.now()}`,
    recovery = `${target}.recovery-${Date.now()}`;
  const check = new Database(backupPath);
  try {
    check.pragma("foreign_keys = ON");
    const tables = new Set(
      (
        check
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );
    const requiredTables = [
      "schema_migrations",
      "clients",
      "quotations",
      "quotation_items",
      "orders",
      "payments",
      "tasks",
    ];
    const migrationVersions = check.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
    const appliedVersions = migrationVersions.map((row) => row.version);
    const claimedVersion = appliedVersions[appliedVersions.length - 1] ?? 0;
    const supportedVersions = readMigrations().map((name) => Number(name.slice(0, 3)));
    const latestSupportedVersion = supportedVersions[supportedVersions.length - 1] ?? 0;
    const expectedAppliedVersions = supportedVersions.filter((version) => version <= claimedVersion);
    const versionedTables: Record<number, string[]> = {
      2: ["quotation_status_history", "business_profile"],
      3: ["invoices", "invoice_items", "invoice_payments", "invoice_status_history", "invoice_number_sequences"],
      4: ["order_status_history", "task_status_history", "payment_reversals"],
    };
    const requiredForClaimedVersion = Object.entries(versionedTables)
      .filter(([version]) => Number(version) <= claimedVersion)
      .flatMap(([, names]) => names);
    const requiredColumns: Record<string, string[]> = {
      schema_migrations: ["version", "applied_at"],
      clients: ["id", "client_code", "name", "archived_at"],
      quotations: ["id", "client_id", "status", "total_minor"],
      quotation_items: ["id", "quotation_id", "line_total_minor"],
      orders: ["id", "client_id", "status", "agreed_amount_minor"],
      payments: ["id", "order_id", "amount_minor"],
      tasks: ["id", "status"],
      quotation_status_history: ["quotation_id", "new_status"],
      business_profile: ["id", "business_name"],
      invoices: ["id", "status", "total_minor"],
      invoice_items: ["id", "invoice_id", "line_total_minor"],
      invoice_payments: ["id", "invoice_id", "amount_minor"],
      invoice_status_history: ["invoice_id", "new_status"],
      invoice_number_sequences: ["year", "last_number"],
      order_status_history: ["order_id", "new_status"],
      task_status_history: ["task_id", "new_status"],
      payment_reversals: ["order_payment_id", "invoice_payment_id", "amount_minor", "reason", "reversed_at"],
    };
    const requiredColumnEntries = Object.entries(requiredColumns)
      .filter(([table]) => requiredTables.concat(requiredForClaimedVersion).includes(table));
    const hasRequiredColumns = requiredColumnEntries.every(([table, columns]) => {
      const actual = new Set((check.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name));
      return columns.every((column) => actual.has(column));
    });
    if (
      (check.pragma("integrity_check") as { integrity_check: string }[])[0]
        ?.integrity_check !== "ok" ||
      (check.pragma("foreign_key_check") as unknown[]).length > 0 ||
      claimedVersion < 1 ||
      claimedVersion > latestSupportedVersion ||
      expectedAppliedVersions.length !== appliedVersions.length ||
      expectedAppliedVersions.some((version, index) => version !== appliedVersions[index]) ||
      requiredTables.concat(requiredForClaimedVersion).some((name) => !tables.has(name)) ||
      !hasRequiredColumns
    )
      throw new Error("Invalid backup database.");
  } finally {
    check.close();
  }
  current?.close();
  current = undefined;
  try {
    renameSync(target, recovery);
    copyFileSync(backupPath, candidate);
    renameSync(candidate, target);
    current = openDatabase(target);
    currentPath = target;
    return recovery;
  } catch (error) {
    try {
      rmSync(candidate, { force: true });
      if (!current && existsSync(recovery)) {
        if (existsSync(target))
          renameSync(target, `${target}.failed-${Date.now()}`);
        renameSync(recovery, target);
      }
      current = openDatabase(target);
      currentPath = target;
    } catch {
      /* preserve original failure; recovery file remains available */
    }
    throw error;
  }
}
export function setDatabaseForTests(db?: Db) {
  current?.close();
  current = db;
  currentPath = undefined;
}
export function removeDatabaseFile(path: string) {
  try {
    unlinkSync(path);
  } catch {
    /* best effort cleanup */
  }
}
