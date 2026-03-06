// TQP Token Cost Estimation
// Estimates the number of tokens in a JSON response using a simple heuristic:
// ~4 characters per token (rough average for JSON data).

const CHARS_PER_TOKEN = 4;

export function estimateTokens(data: unknown): number {
  if (data === null || data === undefined) return 1;
  const json = JSON.stringify(data);
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}
