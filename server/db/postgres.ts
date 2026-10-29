import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type PoolClient, type QueryResult } from "pg";

export const POSTGRES_DATA_TABLES = [
  "clients", "quotations", "quotation_items", "orders", "payments", "tasks",
  "quotation_status_history", "business_profile", "invoices", "invoice_items",
  "invoice_payments", "invoice_status_history", "invoice_number_sequences",
  "order_status_history", "task_status_history", "payment_reversals",
  "razorpay_payment_links", "razorpay_payment_attempts", "razorpay_refunds",
  "razorpay_webhook_events", "invoice_email_deliveries",
] as const;

pg.types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("PostgreSQL integer is outside JavaScript's safe range.");
  return parsed;
});

function postgresPlaceholders(sql: string) {
  let result = "", index = 0, single = false, double = false, lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1];
    if (lineComment) { result += char; if (char === "\n") lineComment = false; continue; }
    if (blockComment) { result += char; if (char === "*" && next === "/") { result += next; i++; blockComment = false; } continue; }
    if (!single && !double && char === "-" && next === "-") { result += "--"; i++; lineComment = true; continue; }
    if (!single && !double && char === "/" && next === "*") { result += "/*"; i++; blockComment = true; continue; }
    if (char === "'" && !double) { result += char; if (single && next === "'") { result += next; i++; } else single = !single; continue; }
    if (char === '"' && !single) { result += char; if (double && next === '"') { result += next; i++; } else double = !double; continue; }
    if (char === "?" && !single && !double) { result += `$${++index}`; continue; }
    result += char;
  }
  return result;
}

export class PostgresDatabase {
  private readonly pool: pg.Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL.");
    const normalizedUrl = new URL(connectionString);
    if (normalizedUrl.searchParams.get("sslmode") === "require") normalizedUrl.searchParams.set("sslmode", "verify-full");
    this.pool = new pg.Pool({
      connectionString: normalizedUrl.toString(),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      enableChannelBinding: true,
      application_name: "jsncrm-render",
    });
    this.pool.on("error", (error) => console.error("PostgreSQL idle connection error:", error.message));
  }

  prepare(sql: string) {
    const text = postgresPlaceholders(sql)
      .replace(/\bLIKE\b/gi, "ILIKE")
      .replace(/\bMAX\(\s*0\s*,/gi, "GREATEST(0,");
    const execute = (values: unknown[]) => {
      const client = this.transactionClient.getStore() || this.pool;
      return client.query(text, values.map((value) => value === undefined ? null : value));
    };
    return {
      get: async (...values: unknown[]) => (await execute(values)).rows[0],
      all: async (...values: unknown[]) => (await execute(values)).rows,
      run: async (...values: unknown[]) => {
        const result: QueryResult = await execute(values);
        return { changes: result.rowCount ?? 0 };
      },
    };
  }

  transaction<T>(callback: () => T | Promise<T>) {
    return async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await this.transactionClient.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
      const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => Number(row.version)));
      const directory = fileURLToPath(new URL("./postgres-migrations/", import.meta.url));
      const migrations = readdirSync(directory).filter((name) => /^\d+_.*\.sql$/.test(name)).sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));
      for (const name of migrations) {
        const version = Number(name.slice(0, 3));
        if (applied.has(version)) continue;
        await client.query("BEGIN");
        try {
          await client.query(readFileSync(join(directory, name), "utf8"));
          await client.query("INSERT INTO schema_migrations(version, applied_at) VALUES ($1,$2)", [version, new Date().toISOString()]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async exportSnapshot() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const tables: Record<string, unknown[]> = {};
      for (const table of POSTGRES_DATA_TABLES) {
        tables[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
      }
      await client.query("COMMIT");
      return { format: "jsn-postgres-backup", version: 1, created_at: new Date().toISOString(), tables };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreSnapshot(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object") throw new Error("Invalid backup.");
    const data = snapshot as { format?: unknown; version?: unknown; tables?: unknown };
    if (data.format !== "jsn-postgres-backup" || data.version !== 1 || !data.tables || typeof data.tables !== "object") {
      throw new Error("Invalid backup.");
    }
    const tables = data.tables as Record<string, unknown>;
    if (Object.keys(tables).length !== POSTGRES_DATA_TABLES.length || POSTGRES_DATA_TABLES.some((table) => !Array.isArray(tables[table]))) {
      throw new Error("Invalid backup.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const columnsByTable = new Map<string, string[]>();
      for (const table of POSTGRES_DATA_TABLES) {
        const result = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",
          [table],
        );
        if (!result.rows.length) throw new Error("Database schema is incomplete.");
        const columns = result.rows.map((row) => String(row.column_name));
        columnsByTable.set(table, columns);
        for (const row of tables[table] as unknown[]) {
          if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid backup row.");
          const keys = Object.keys(row as object).sort();
          if (keys.length !== columns.length || keys.some((key, index) => key !== [...columns].sort()[index])) {
            throw new Error("Backup schema does not match this application.");
          }
        }
      }

      await client.query(`TRUNCATE TABLE ${[...POSTGRES_DATA_TABLES].reverse().map((table) => `"${table}"`).join(",")} RESTART IDENTITY CASCADE`);
      for (const table of POSTGRES_DATA_TABLES) {
        const columns = columnsByTable.get(table)!;
        const names = columns.map((column) => `"${column}"`).join(",");
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
        for (const row of tables[table] as Record<string, unknown>[]) {
          await client.query(`INSERT INTO "${table}" (${names}) VALUES (${placeholders})`, columns.map((column) => row[column] ?? null));
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
  async healthCheck() { await this.pool.query("SELECT 1"); }
}
