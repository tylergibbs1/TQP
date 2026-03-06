// tqp codegen <manifest.json> [--output types.ts]

import { existsSync } from "fs";
import { resolve } from "path";
import { generateTypes } from "../../codegen";
import type { Manifest } from "../../types";

export async function codegen(args: string[]) {
  const file = args[0];
  if (!file) {
    console.error("Usage: tqp codegen <manifest.json> [--output types.ts]");
    process.exit(1);
  }

  let output: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      output = args[++i];
    }
  }

  const fullPath = resolve(process.cwd(), file);
  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const content = await Bun.file(fullPath).text();
  const manifest: Manifest = JSON.parse(content);
  const generated = generateTypes(manifest);

  if (output) {
    const outputPath = resolve(process.cwd(), output);
    await Bun.write(outputPath, generated);
    console.log(`Generated types written to ${outputPath}`);
  } else {
    console.log(generated);
  }
}
