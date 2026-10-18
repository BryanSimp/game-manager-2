import { eq } from "drizzle-orm";
import { API_KEY_PREFIX } from "@gm/shared";
import { auth } from "../auth.js";
import { db, schema } from "../db/index.js";
import type { SessionUser } from "../plugins/auth.js";

/**
 * Who is calling `/api/mcp`.
 *
 * Deliberately separate from `getSessionUser`: the MCP endpoint never looks
 * at cookies, the demo headers or the bearer *session* token the mobile app
 * uses. It takes exactly one thing — `Authorization: Bearer <credential>` —
 * and that credential is a personal API key. Accepting a browser session
 * here would make the endpoint callable cross-site by any page you visit
 * while signed in, which is precisely the ambient authority an API key
 * exists to avoid.
 */
export interface McpCaller {
  user: SessionUser;
  via: "api_key";
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * The account a credential belongs to, if it's still one that may read.
 * Banned accounts are refused here as well as at sign-in — a key minted
 * before the ban must not outlive it — and demo accounts never get a key in
 * the first place, but are refused anyway rather than trusted not to.
 */
async function callerFor(userId: string, via: McpCaller["via"]): Promise<McpCaller | null> {
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
  return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, via };
}

async function viaApiKey(key: string): Promise<McpCaller | null> {
  // server-side call: better-auth hashes the key and looks the hash up, and
  // refuses disabled and expired keys itself
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  return callerFor(result.key.referenceId, "api_key");
}

/** Resolve the caller from an `Authorization` header, or null for a 401. */
export async function authenticateMcp(authorization: string | undefined): Promise<McpCaller | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  if (token.startsWith(API_KEY_PREFIX)) return viaApiKey(token);
  return null;
}
