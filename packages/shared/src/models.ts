/**
 * The models an agent can be hired with. Pinned full ids rather than the CLI's
 * `opus`/`sonnet` aliases: an agent hired today should keep running the same
 * model tomorrow, so cost and behaviour stay predictable. The price of that is
 * this list, which needs a line adding when a new model ships.
 */
export interface ClaudeModel {
  id: string;
  label: string;
  blurb: string;
  /** Tokens the model can hold, used for the context gauge. */
  contextWindow: number;
}

const M = 1_000_000;
const K = 1_000;

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { id: "claude-opus-5", label: "Opus 5", blurb: "Best all-round.", contextWindow: M },
  { id: "claude-sonnet-5", label: "Sonnet 5", blurb: "Faster, cheaper.", contextWindow: M },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", blurb: "Cheapest.", contextWindow: 200 * K },
  { id: "claude-fable-5-1", label: "Fable 5.1", blurb: "Most capable, premium.", contextWindow: M },
];

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * The context gauge was a flat 200k for every model, so an agent on a 1M
 * model read five times fuller than it was — a run barely started looked
 * close to needing a compaction.
 *
 * Aliases resolve to the current model in that tier, which is what the CLI
 * does with them. An id we do not recognise gets the current generation's
 * window rather than the smallest one: guessing small overstates the gauge,
 * which is the failure we are fixing.
 */
const ALIASES: Record<string, string> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5-1",
};

export function contextWindowFor(model: string | null | undefined): number {
  if (!model) return M;
  const id = ALIASES[model] ?? model;
  return CLAUDE_MODELS.find((m) => m.id === id)?.contextWindow ?? M;
}
