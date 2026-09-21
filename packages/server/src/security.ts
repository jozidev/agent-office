/**
 * The trust boundary. Until this existed the server treated "bound to
 * 127.0.0.1" as authorization, which it is not:
 *
 *  - WebSockets are exempt from the same-origin policy, so any page in any tab
 *    could open `ws://127.0.0.1:4177/ws`, receive the full office snapshot and
 *    then hire an agent and assign it a ticket — which spawns `claude` with
 *    Bash allowlisted. Drive-by remote code execution. `Origin` stops this.
 *  - A name that resolves to 127.0.0.1 makes the whole HTTP API same-origin to
 *    the attacker's page, so `Origin` alone would still be bypassable. `Host`
 *    stops that (DNS rebinding).
 *
 * A browser always sets `Origin` on a WS upgrade and always sets `Host`, so
 * both checks bite exactly when the caller is a browser we did not serve. A
 * *missing* `Origin` means a non-browser caller (curl, release-dry's own
 * check, a local script); no origin check can authenticate those either way,
 * so they pass here and are left to the session token. Pretending otherwise
 * would break the release check while stopping no attacker.
 */

/** The only names that can legitimately reach a loopback-bound server. */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** The subset that appears in an origin; `[::1]` is only ever a Host. */
const LOOPBACK_NAMES = ["localhost", "127.0.0.1"];

/** Where the UI runs under `pnpm dev`, when it is not served from our own port. */
const VITE_DEV_PORT = 5173;
const VITE_DEV_ORIGINS = LOOPBACK_NAMES.map((h) => `http://${h}:${VITE_DEV_PORT}`);



export interface OriginOptions {
  /** the port this server listens on; its loopback origins are always allowed */
  port?: number;
  /** true when the UI is not served from this origin, i.e. Vite is serving it */
  dev?: boolean;
  /** AGENT_OFFICE_ALLOWED_ORIGINS, comma separated, for setups we cannot guess */
  extra?: string;
}

export function allowedOrigins({ port, dev, extra }: OriginOptions): string[] {
  const out = new Set<string>();
  if (port) for (const h of LOOPBACK_HOSTS) out.add(`http://${h}:${port}`);
  if (dev) for (const o of VITE_DEV_ORIGINS) out.add(o);
  for (const o of (extra ?? "").split(",").map((s) => s.trim()).filter(Boolean)) out.add(o);
  return [...out];
}

/**
 * True when this request may proceed. Absent Origin passes (see the file
 * header); anything present must match the allowlist exactly — no prefix
 * matching, since `http://127.0.0.1:4177.evil.com` starts with our origin.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

/** The ports a Host header may legitimately name. */
export function allowedHostPorts({ port, dev }: Pick<OriginOptions, "port" | "dev">): number[] {
  const ports = port ? [port] : [];
  // Vite rewrites Host to the proxy target for an ordinary request but leaves
  // it alone on a WebSocket upgrade, so under `pnpm dev` the upgrade arrives
  // claiming :5173. Without this the office's socket is refused and the client
  // reconnects forever, while /api works — which is a confusing way to fail.
  if (dev) ports.push(VITE_DEV_PORT);
  return ports;
}

/**
 * True when the Host header names a loopback address. Unlike Origin this must
 * fail closed on absence: HTTP/1.1 requires Host, so a missing one is not a
 * friendly non-browser client, it is someone hand-rolling a request.
 *
 * The port is checked against the ports we actually serve, so a rebound name
 * cannot ride in on a matching hostname with a different port. The hostname
 * check is what stops DNS rebinding; the port only narrows it further.
 */
export function isAllowedHost(host: string | undefined, ports?: number | readonly number[]): boolean {
  if (!host) return false;
  const at = host.lastIndexOf(":");
  // An IPv6 literal is bracketed, so the last colon is the port separator only
  // when it comes after the closing bracket.
  const hasPort = at > host.lastIndexOf("]");
  const name = hasPort ? host.slice(0, at) : host;
  const given = hasPort ? host.slice(at + 1) : "";
  if (!LOOPBACK_HOSTS.includes(name)) return false;
  const allowed = ports === undefined ? [] : typeof ports === "number" ? [ports] : ports;
  if (!allowed.length) return true;
  return allowed.some((p) => given === String(p));
}
