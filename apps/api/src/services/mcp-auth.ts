import { eq } from "drizzle-orm";
import { API_KEY_PREFIX, MCP_SCOPE, MCP_WRITE_SCOPE } from "@gm/shared";
import { auth } from "../auth.js";
import { db, schema } from "../db/index.js";
import type { SessionUser } from "../plugins/auth.js";
import { OAUTH_ACCESS_TOKEN_PREFIX, verifyOAuthAccessToken } from "./oauth.js";

/**
 * Who is calling `/api/mcp`.
 *
 * Deliberately separate from `getSessionUser`: the MCP endpoint never looks
 * at cookies, the demo headers or the bearer *session* token the mobile app
 * uses. It takes exactly one thing — `Authorization: Bearer <credential>` —
 * and that credential is either a personal API key (Claude Code) or an OAuth
 * access token (claude.ai's connector). Accepting a browser session here
 * would make the endpoint callable cross-site by any page you visit while
 * signed in, which is precisely the ambient authority both of those exist to
 * avoid.
 *
 * The two are told apart by prefix (`gm_` / `gmat_`), so a request costs one
 * lookup, never a guess at both.
 *
 * Either kind of credential reads. Writing is a second, separate grant that
 * has to be asked for when the credential is made: an API key created with
 * "Allow changes" on, or an OAuth token whose consent included
 * `library:write`. Anything made before writes existed has neither, so it
 * stays read-only without anyone having to do anything.
 */
export interface McpCaller {
  user: SessionUser;
  via: "api_key" | "oauth";
  /** may use the write tools; checked by every one of them */
  canWrite: boolean;
}

export type McpAuth =
  | { ok: true; caller: McpCaller }
  /** no credential at all, or one that doesn't check out */
  | { ok: false; status: 401; presented: boolean }
  /** a real OAuth token, but not one granted `library:read` */
  | { ok: false; status: 403 };

/**
 * An API key's grant, in the api-key plugin's own `permissions` shape (a
 * resource → actions map, stored as JSON on the key's row and set only
 * server-side). Keys made before writes existed have no permissions at all,
 * which reads the same as `READ_ONLY_KEY_PERMISSIONS`.
 */
export const READ_ONLY_KEY_PERMISSIONS = { library: ["read"] };
export const WRITE_KEY_PERMISSIONS = { library: ["read", "write"] };

/** Does a key's stored (or plugin-parsed) permissions allow the write tools? */
export function keyAllowsChanges(permissions: unknown): boolean {
  let value = permissions;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  const library = (value as { library?: unknown } | null | undefined)?.library;
  return Array.isArray(library) && library.includes("write");
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * The account a credential belongs to, if it's still one that may read.
 * Banned accounts are refused here as well as at sign-in — a key or token
 * minted before the ban must not outlive it — and demo accounts can't hold
 * either, but are refused anyway rather than trusted not to.
 */
async function callerFor(
  userId: string,
  via: McpCaller["via"],
  canWrite: boolean,
): Promise<McpCaller | null> {
  const [row] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.user.role,
      banned: schema.user.banned,
      banExpires: schema.user.banExpires,
      isDemo: schema.user.isDemo,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!row || row.isDemo) return null;
  if (row.banned && (!row.banExpires || row.banExpires > new Date())) return null;
  return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, via, canWrite };
}

async function viaApiKey(key: string): Promise<McpAuth> {
  // server-side call: better-auth hashes the key and looks the hash up, and
  // refuses disabled and expired keys itself
  const result = await auth.api.verifyApiKey({ body: { key } });
  const caller =
    result.valid && result.key
      ? await callerFor(result.key.referenceId, "api_key", keyAllowsChanges(result.key.permissions))
      : null;
  return caller ? { ok: true, caller } : { ok: false, status: 401, presented: true };
}

async function viaOAuth(token: string): Promise<McpAuth> {
  const verified = await verifyOAuthAccessToken(token);
  if (!verified) return { ok: false, status: 401, presented: true };
  // signing in with Game Manager isn't the same as letting an app read the
  // library: only a token granted library:read gets through. library:write
  // adds to that and never stands in for it.
  if (!verified.scopes.includes(MCP_SCOPE)) return { ok: false, status: 403 };
  const caller = await callerFor(verified.userId, "oauth", verified.scopes.includes(MCP_WRITE_SCOPE));
  return caller ? { ok: true, caller } : { ok: false, status: 401, presented: true };
}

/** Resolve the caller from an `Authorization` header. */
export async function authenticateMcp(authorization: string | undefined): Promise<McpAuth> {
  const token = bearerToken(authorization);
  if (!token) return { ok: false, status: 401, presented: false };
  if (token.startsWith(API_KEY_PREFIX)) return viaApiKey(token);
  if (token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return viaOAuth(token);
  return { ok: false, status: 401, presented: true };
}
