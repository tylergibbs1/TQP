// tqp init <name>

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const SERVER_TEMPLATE = (name: string) => `import { TQP } from "tqp";

const server = new TQP({
  name: "${name}",
  description: "${name} TQP server",
});

// Define your types
server.type("Item", {
  id:   { type: "string" },
  name: { type: "string" },
  data: { type: "string", cost: "high" },
});

// Define your actions
server.action("get_item", {
  description: "Get an item by ID",
  input: {
    id: { type: "string", required: true },
  },
  returns: "Item",
  safe: true,
  handler: async ({ id }) => ({
    id: id as string,
    name: "Example Item",
    data: "Full item data...",
  }),
});

server.action("list_items", {
  description: "List all items",
  input: {
    limit: { type: "int", default: 10 },
  },
  returns: "list:Item",
  safe: true,
  handler: async ({ limit }) => [
    { id: "1", name: "First", data: "data1" },
    { id: "2", name: "Second", data: "data2" },
  ],
});

server.listen({ transport: "http", port: 3000 });
`;

const PACKAGE_JSON = (name: string) => `{
  "name": "${name}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch server.ts",
    "start": "bun run server.ts"
  },
  "dependencies": {
    "tqp": "file:../"
  }
}
`;

export async function init(args: string[]) {
  const name = args[0];
  if (!name) {
    console.error("Usage: tqp init <name>");
    process.exit(1);
  }

  const dir = join(process.cwd(), name);

  if (existsSync(dir)) {
    console.error(`Directory '${name}' already exists`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });

  await Bun.write(join(dir, "server.ts"), SERVER_TEMPLATE(name));
  await Bun.write(join(dir, "package.json"), PACKAGE_JSON(name));

  console.log(`Created TQP server '${name}'`);
  console.log("");
  console.log("  cd " + name);
  console.log("  bun install");
  console.log("  bun run dev");
}
