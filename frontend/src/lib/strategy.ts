const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Splits on commas only when the next part starts a new lowercase clause ("…, no leverage"),
 * so token lists like "ETH, USDC and DAI" stay whole.
 */
function splitCommas(sentence: string): string[] {
  const parts = sentence.split(/,\s+/);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && (/^[A-Z0-9$]/.test(p) || words(out[out.length - 1]) < 2)) out[out.length - 1] += `, ${p}`;
    else out.push(p);
  }
  return out;
}

/**
 * Splits free-text strategy into short rules for display as chips, e.g.
 * "Demo agent: only trades ETH/USDC on Base, max 25% of portfolio per trade, no leverage"
 * → ["only trades ETH/USDC on Base", "max 25% of portfolio per trade", "no leverage"].
 */
export function strategyRules(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim().replace(/^[^:]{1,30}:\s+/, ''))
    .flatMap(splitCommas)
    .map((r) => r.trim().replace(/[.;]+$/, ''))
    .filter((r) => r.length > 0)
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1));
}

/** Loose match so small edits (case, trailing punctuation) still highlight the rule. */
export function sameRule(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9%/]+/g, ' ')
      .trim();
  return norm(a) === norm(b);
}
