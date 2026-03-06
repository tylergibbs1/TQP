// tqp serve [file]

import { existsSync } from "fs";
import { resolve } from "path";

export async function serve(args: string[]) {
  const file = args[0] ?? "server.ts";
  const fullPath = resolve(process.cwd(), file);

  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  // Parse port flag
  let port: number | undefined;
  const portIdx = args.indexOf("--port");
  const portIdxShort = args.indexOf("-p");
  const pidx = portIdx !== -1 ? portIdx : portIdxShort;
  if (pidx !== -1 && args[pidx + 1]) {
    port = parseInt(args[pidx + 1], 10);
  }

  if (port) {
    process.env.TQP_PORT = String(port);
  }

  // Import and run the server file
  await import(fullPath);
}
