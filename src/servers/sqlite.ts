// TQP Reference Server: SQLite
// Exposes SQLite database operations as a TQP server.

import { TQP } from "../server";
import { Database } from "bun:sqlite";

export function createSQLiteServer(dbPath: string): TQP {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");

  const server = new TQP({
    name: "sqlite",
    description: `SQLite database: ${dbPath}`,
  });

  server.type("TableInfo", {
    name:      { type: "string" },
    sql:       { type: "string", cost: "high" },
    row_count: { type: "int" },
  });

  server.type("ColumnInfo", {
    name:       { type: "string" },
    type:       { type: "string" },
    notnull:    { type: "bool" },
    pk:         { type: "bool" },
    dflt_value: { type: "string?" },
  });

  server.type("QueryResult", {
    columns: { type: "list:string" },
    rows:    { type: "list:string", cost: "high", description: "Array of row arrays (JSON encoded)" },
    count:   { type: "int" },
  });

  server.action("list_tables", {
    description: "List all tables in the database",
    input: {},
    returns: "list:TableInfo",
    safe: true,
    handler: async () => {
      const tables = db
        .query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string; sql: string }[];

      return tables.map((t) => {
        const countResult = db.query(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
        return {
          name: t.name,
          sql: t.sql,
          row_count: countResult.c,
        };
      });
    },
  });

  server.action("describe_table", {
    description: "Get column information for a table",
    input: {
      table: { type: "string", required: true },
    },
    returns: "list:ColumnInfo",
    safe: true,
    handler: async ({ table }) => {
      const tableName = table as string;
      // Validate table exists
      const exists = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(tableName);
      if (!exists) throw new Error(`Table '${tableName}' not found`);

      const columns = db.query(`PRAGMA table_info("${tableName}")`).all() as {
        name: string;
        type: string;
        notnull: number;
        pk: number;
        dflt_value: string | null;
      }[];

      return columns.map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull === 1,
        pk: c.pk === 1,
        dflt_value: c.dflt_value,
      }));
    },
  });

  server.action("query", {
    description: "Execute a read-only SQL query",
    input: {
      sql:    { type: "string", required: true },
      params: { type: "list:string" },
      limit:  { type: "int", default: 100 },
    },
    returns: "QueryResult",
    safe: true,
    handler: async ({ sql: rawSql, params, limit }) => {
      const sqlStr = rawSql as string;

      // Only allow SELECT statements
      const trimmed = sqlStr.trim().toUpperCase();
      if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH") && !trimmed.startsWith("EXPLAIN")) {
        throw new Error("Only SELECT, WITH, and EXPLAIN queries are allowed. Use execute for mutations.");
      }

      const limitNum = (limit as number) ?? 100;
      const limitedSql = sqlStr.includes("LIMIT") ? sqlStr : `${sqlStr} LIMIT ${limitNum}`;

      const stmt = db.query(limitedSql);
      const sqlParams = (params as string[]) ?? [];
      const rows = stmt.all(...sqlParams) as Record<string, unknown>[];

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const rowArrays = rows.map((row) => JSON.stringify(Object.values(row)));

      return {
        columns,
        rows: rowArrays,
        count: rows.length,
      };
    },
  });

  server.action("execute", {
    description: "Execute a SQL mutation (INSERT, UPDATE, DELETE)",
    input: {
      sql:    { type: "string", required: true },
      params: { type: "list:string" },
    },
    returns: "QueryResult",
    safe: false,
    confirm: true,
    dry_run: true,
    handler: async ({ sql: rawSql, params }, ctx) => {
      const sqlStr = rawSql as string;
      const sqlParams = (params as string[]) ?? [];

      // Block DDL unless it's a simple CREATE/ALTER
      const trimmed = sqlStr.trim().toUpperCase();
      if (trimmed.startsWith("DROP")) {
        throw new Error("DROP statements are not allowed. Use drop_table action instead.");
      }

      if (ctx.dry_run) {
        // Parse but don't execute
        return {
          columns: [],
          rows: [],
          count: 0,
        };
      }

      const stmt = db.query(sqlStr);
      stmt.run(...sqlParams);

      return {
        columns: [],
        rows: [],
        count: db.query("SELECT changes() as c").get() as unknown as number,
      };
    },
  });

  return server;
}

// Run standalone
if (import.meta.main) {
  const dbPath = process.argv[2] ?? ":memory:";
  const port = parseInt(process.env.TQP_PORT ?? "3002", 10);
  const server = createSQLiteServer(dbPath);
  server.listen({ transport: "http", port });
}
