import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/database.ts";
import { PostgresDatabase, POSTGRES_DATA_TABLES } from "../server/db/postgres.ts";

const sourcePath = process.env.SQLITE_SOURCE || join(
  process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
  "JSN Designs Business Studio",
  "business.sqlite",
);
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL for the Neon destination.");
if (!existsSync(sourcePath)) throw new Error("The configured SQLite source file does not exist.");

const snapshotPath = join(tmpdir(), `jsn-sqlite-snapshot-${process.pid}-${randomUUID()}.sqlite`);
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
let destination: PostgresDatabase | undefined;
let sourceClosed = false;

try {
  await source.backup(snapshotPath);
  source.close();
  sourceClosed = true;
  const upgradedSnapshot = openDatabase(snapshotPath);
  upgradedSnapshot.close();
  const sqlite = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    for (const table of POSTGRES_DATA_TABLES) {
      if (!tables.has(table)) throw new Error(`SQLite source is missing required table: ${table}`);
    }
    const versions = (sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map((row) => row.version);
    if (versions.length !== 6 || versions.some((version, index) => version !== index + 1)) {
      throw new Error("SQLite snapshot could not be upgraded through schema version 6.");
    }

    destination = new PostgresDatabase();
    await destination.migrate();

    const existing: Record<string, number> = {};
    for (const table of POSTGRES_DATA_TABLES) {
      existing[table] = Number((await destination.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: string | number }).count);
    }
    const profile = await destination.prepare("SELECT business_name,contact_person,email,phone,address,website,default_terms,default_validity_days,currency FROM business_profile WHERE id=1").get() as Record<string, unknown> | undefined;
    const defaultProfile = !!profile && profile.business_name === "" && profile.contact_person === "" && profile.email === "" && profile.phone === "" && profile.address === "" && profile.website === "" && profile.default_terms === "" && Number(profile.default_validity_days) === 30 && profile.currency === "INR";
    const unsafeTables = Object.entries(existing).filter(([table, count]) => count > (table === "business_profile" && defaultProfile ? 1 : 0));
    if (unsafeTables.length || (existing.business_profile !== 1 && existing.business_profile !== 0)) {
      throw new Error("Neon already contains application data; migration stopped without changing it.");
    }

    const sourceRows = new Map<string, Record<string, unknown>[]>();
    const sourceCounts: Record<string, number> = {};
    for (const table of POSTGRES_DATA_TABLES) {
      sourceRows.set(table, sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]);
      sourceCounts[table] = sourceRows.get(table)!.length;
    }

    const invoices = sourceRows.get("invoices")!;
    const invoiceById = new Map(invoices.map((invoice) => [String(invoice.id), invoice]));
    const depthById = new Map<string, number>();
    const invoiceDepth = (id: string, visiting = new Set<string>()): number => {
      if (depthById.has(id)) return depthById.get(id)!;
      if (visiting.has(id)) throw new Error("SQLite invoice reissue references contain a cycle.");
      visiting.add(id);
      const parent = invoiceById.get(id)?.reissued_from_id;
      const depth = parent && invoiceById.has(String(parent)) ? invoiceDepth(String(parent), visiting) + 1 : 0;
      visiting.delete(id);
      depthById.set(id, depth);
      return depth;
    };
    invoices.sort((a, b) => invoiceDepth(String(a.id)) - invoiceDepth(String(b.id)));

    await destination.transaction(async () => {
      if (existing.business_profile === 1) await destination!.prepare("DELETE FROM business_profile WHERE id=1").run();
      for (const table of POSTGRES_DATA_TABLES) {
        const rows = sourceRows.get(table)!;
        if (!rows.length) continue;
        const columns = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name);
        const columnSql = columns.map((column) => `"${column}"`).join(",");
        const placeholders = columns.map(() => "?").join(",");
        const insert = destination!.prepare(`INSERT INTO "${table}" (${columnSql}) VALUES (${placeholders})`);
        for (const row of rows) await insert.run(...columns.map((column) => row[column] ?? null));
      }
      for (const table of POSTGRES_DATA_TABLES) {
        const copied = Number((await destination!.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: string | number }).count);
        if (copied !== sourceCounts[table]) throw new Error(`Row count verification failed for ${table}.`);
      }
    })();

    console.log(JSON.stringify({ source: "SQLite", destination: "PostgreSQL", migrated_rows: sourceCounts }, null, 2));
  } finally {
    sqlite.close();
  }
} finally {
  if (!sourceClosed) source.close();
  await destination?.close();
  rmSync(snapshotPath, { force: true });
  rmSync(`${snapshotPath}-wal`, { force: true });
  rmSync(`${snapshotPath}-shm`, { force: true });
}
