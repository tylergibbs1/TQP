// Shared stats tracking for benchmarks via temp file
import { readFileSync, writeFileSync } from "fs";

const STATS_FILE = "/tmp/tqp-bench-stats.json";

export interface BenchStats {
  api_calls: number;
  resolver_runs: number;
  resolver_skips: number;
}

export function resetStats(): void {
  writeFileSync(STATS_FILE, JSON.stringify({ api_calls: 0, resolver_runs: 0, resolver_skips: 0 }));
}

export function readStats(): BenchStats {
  try {
    return JSON.parse(readFileSync(STATS_FILE, "utf-8"));
  } catch {
    return { api_calls: 0, resolver_runs: 0, resolver_skips: 0 };
  }
}

export function incStat(key: keyof BenchStats, amount = 1): void {
  const stats = readStats();
  stats[key] += amount;
  writeFileSync(STATS_FILE, JSON.stringify(stats));
}
