/**
 * Deciding what in an agent's output is a path worth linking, kept free of
 * React so it can be tested directly.
 *
 * The first attempt scanned for "/" anywhere in a string, which turned
 * `docs/architecture.md` into a link to `/architecture.md` and `and/or` into
 * a link to `/or`. Whole tokens, not substrings.
 */

/** Characters that cannot be part of a path in prose — including markdown table pipes and backticks. */
export const DELIMITERS = /([\s`'"(),|[\]<>{}]+)/;

/** Prose punctuation that ends a sentence rather than a filename. */
const TRAILING = /[.,:;!?)\]]+$/;

/** A last segment like `.md` or `.tsx`, which is what makes a relative path recognisable as one. */
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

export function stripTrailingPunctuation(token: string): string {
  return token.replace(TRAILING, "");
}

function isAbsolute(token: string): boolean {
  return token.startsWith("/") || token.startsWith("~/");
}

/**
 * Resolves a token to a path worth linking, or null.
 *
 * Relative paths need the agent's working folder to mean anything, and
 * without a file extension they are far more likely to be prose ("and/or",
 * "read/write", "km/h") than a file. Guessing wrong is worse than not
 * linking: a bogus absolute path can land on a real, unrelated file.
 */
export function resolvePath(token: string, baseDir?: string): string | null {
  if (!token || token.includes("://") || !token.includes("/")) return null;
  if (isAbsolute(token)) return token.length >= 3 ? token : null;
  if (!baseDir || !HAS_EXTENSION.test(token)) return null;
  const rel = token.replace(/^\.\//, "");
  // "../" is ambiguous enough that resolving it would be guessing.
  if (rel.startsWith("../")) return null;
  return `${baseDir.replace(/\/+$/, "")}/${rel}`;
}
