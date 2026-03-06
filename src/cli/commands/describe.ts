// tqp describe <type> [--url URL]

import { TQPClient } from "../../client";

export async function describe(args: string[]) {
  const typeName = args[0];
  if (!typeName) {
    console.error("Usage: tqp describe <type> [--url URL]");
    process.exit(1);
  }

  let url = "http://localhost:3000";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--url" || args[i] === "-u") {
      url = args[++i];
    }
  }

  const client = new TQPClient(url);
  const response = await client.describe(typeName);

  console.log(JSON.stringify((response as any).data, null, 2));
}
