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
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { id: "claude-opus-5", label: "Opus 5", blurb: "Best all-round." },
  { id: "claude-sonnet-5", label: "Sonnet 5", blurb: "Faster, cheaper." },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", blurb: "Cheapest." },
  { id: "claude-fable-5-1", label: "Fable 5.1", blurb: "Most capable, premium." },
];

export const DEFAULT_MODEL = "claude-opus-5";
