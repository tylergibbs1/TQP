// tqp manifest [--url URL]

import { TQPClient } from "../../client";

export async function manifest(args: string[]) {
  let url = "http://localhost:3000";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" || args[i] === "-u") {
      url = args[++i];
    } else if (!args[i].startsWith("-")) {
      url = args[i];
    }
  }

  const client = new TQPClient(url);
  const m = await client.getManifest();
  console.log(JSON.stringify(m, null, 2));
}
