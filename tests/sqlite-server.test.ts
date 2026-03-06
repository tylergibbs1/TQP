import { describe, test, expect } from "bun:test";
import { createSQLiteServer } from "../src/servers/sqlite";

describe("SQLite Server", () => {
  const server = createSQLiteServer(":memory:");

  // Set up test table
  test("can create table via execute", async () => {
    const res = await server.handle({
      action: "execute",
      input: {
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER)",
      },
      confirmed: true,
    });
    expect(res.error).toBeUndefined();
  });

  test("can insert data via execute", async () => {
    const res = await server.handle({
      action: "execute",
      input: {
        sql: "INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30)",
      },
      confirmed: true,
    });
    expect(res.error).toBeUndefined();

    await server.handle({
      action: "execute",
      input: {
        sql: "INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25)",
      },
      confirmed: true,
    });
  });

  test("list_tables returns table info", async () => {
    const res = await server.handle({
      action: "list_tables",
      input: {},
    });
    const data = res.data as any[];
    expect(data.length).toBeGreaterThanOrEqual(1);
    const users = data.find((t: any) => t.name === "users");
    expect(users).toBeDefined();
    expect(users.row_count).toBe(2);
  });

  test("list_tables with field selection", async () => {
    const res = await server.handle({
      action: "list_tables",
      input: {},
      fields: { name: true, row_count: true },
    });
    const data = res.data as any[];
    const users = data.find((t: any) => t.name === "users");
    expect(users.name).toBe("users");
    expect(users.row_count).toBe(2);
    expect(users.sql).toBeUndefined();
  });

  test("describe_table returns column info", async () => {
    const res = await server.handle({
      action: "describe_table",
      input: { table: "users" },
    });
    const data = res.data as any[];
    expect(data).toHaveLength(4);

    const idCol = data.find((c: any) => c.name === "id");
    expect(idCol.pk).toBe(true);
    expect(idCol.type).toBe("INTEGER");
  });

  test("query returns results", async () => {
    const res = await server.handle({
      action: "query",
      input: { sql: "SELECT name, age FROM users ORDER BY name" },
    });
    const data = res.data as any;
    expect(data.columns).toEqual(["name", "age"]);
    expect(data.count).toBe(2);
    expect(JSON.parse(data.rows[0])).toEqual(["Alice", 30]);
  });

  test("query with field selection", async () => {
    const res = await server.handle({
      action: "query",
      input: { sql: "SELECT * FROM users" },
      fields: { columns: true, count: true },
    });
    const data = res.data as any;
    expect(data.columns).toBeDefined();
    expect(data.count).toBe(2);
    expect(data.rows).toBeUndefined();
  });

  test("query rejects non-SELECT statements", async () => {
    const res = await server.handle({
      action: "query",
      input: { sql: "DELETE FROM users WHERE id = 1" },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("INTERNAL");
  });

  test("execute requires confirmation", async () => {
    const res = await server.handle({
      action: "execute",
      input: { sql: "DELETE FROM users WHERE id = 999" },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("REQUIRES_CONFIRMATION");
  });

  test("execute dry_run does not mutate", async () => {
    const res = await server.handle({
      action: "execute",
      input: { sql: "DELETE FROM users WHERE id = 1" },
      dry_run: true,
      confirmed: true,
    });
    expect(res.error).toBeUndefined();

    // Verify data still exists
    const check = await server.handle({
      action: "query",
      input: { sql: "SELECT COUNT(*) as c FROM users" },
    });
    const count = JSON.parse((check.data as any).rows[0])[0];
    expect(count).toBe(2);
  });

  test("execute blocks DROP statements", async () => {
    const res = await server.handle({
      action: "execute",
      input: { sql: "DROP TABLE users" },
      confirmed: true,
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("INTERNAL");
    expect(res.error!.message).toContain("DROP");
  });

  test("describe_table rejects nonexistent table", async () => {
    const res = await server.handle({
      action: "describe_table",
      input: { table: "nonexistent" },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe("INTERNAL");
  });
});
