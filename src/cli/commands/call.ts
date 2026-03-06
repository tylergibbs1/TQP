// tqp call <action> --input '{}' --fields '{}' --url http://localhost:3000

import { TQPClient } from "../../client";

export async function call(args: string[]) {
  const action = args[0];
  if (!action) {
    console.error("Usage: tqp call <action> [--input JSON] [--fields JSON] [--url URL]");
    process.exit(1);
  }

  let url = "http://localhost:3000";
  let input: Record<string, unknown> | undefined;
  let fields: Record<string, unknown> | undefined;
  let dryRun = false;
  let confirmed = false;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--url":
      case "-u":
        url = args[++i];
        break;
      case "--input":
      case "-i":
        input = JSON.parse(args[++i]);
        break;
      case "--fields":
      case "-f":
        fields = JSON.parse(args[++i]);
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--confirm":
        confirmed = true;
        break;
    }
  }

  const client = new TQPClient(url);
  const response = await client.call(action, {
    input,
    fields: fields as any,
    dry_run: dryRun,
    confirmed,
  });

  if (response.error) {
    console.error("Error:", JSON.stringify(response.error, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(response.data, null, 2));

  if (response.meta) {
    console.error(`\n[meta] tokens: ~${response.meta.cost_tokens_estimate ?? "?"}, dry_run: ${response.meta.dry_run ?? false}`);
  }
}
