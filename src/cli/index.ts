#!/usr/bin/env bun
// TQP CLI

import { parseArgs } from "util";
import { init } from "./commands/init";
import { serve } from "./commands/serve";
import { call } from "./commands/call";
import { describe } from "./commands/describe";
import { manifest } from "./commands/manifest";
import { validate } from "./commands/validate";
import { codegen } from "./commands/codegen";

const USAGE = `
tqp — Typed Query Protocol CLI

Usage:
  tqp init <name>              Scaffold a new TQP server
  tqp serve [file]             Start the dev server (default: server.ts)
  tqp manifest [url]           Print the manifest from a running server
  tqp describe <type> [url]    Describe a specific type
  tqp call <action> [options]  Call an action on a running server
  tqp validate <file>          Validate a manifest JSON file
  tqp codegen <file> [--output <path>]  Generate TypeScript types from manifest

Options:
  --help, -h       Show this help
  --port, -p       Server port (default: 3000)
  --url, -u        Server URL (default: http://localhost:3000)
  --input, -i      JSON input for action call
  --fields, -f     JSON fields selector for action call
  --output, -o     Output file path
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case "init":
      await init(rest);
      break;
    case "serve":
      await serve(rest);
      break;
    case "manifest":
      await manifest(rest);
      break;
    case "describe":
      await describe(rest);
      break;
    case "call":
      await call(rest);
      break;
    case "validate":
      await validate(rest);
      break;
    case "codegen":
      await codegen(rest);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
