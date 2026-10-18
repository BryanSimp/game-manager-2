import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { MCP_SCOPE, MCP_WRITE_SCOPE } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";

/**
 * The OAuth 2.1 side of the MCP endpoint — what claude.ai's custom
 * connectors use instead of a pasted API key.
 *
 * This API is both the authorization server (better-auth's oauth-provider
 * plugin, configured in `auth.ts`) and the resource server (`/api/mcp`), in
 * one process. That's why access tokens are **opaque** rather than JWTs: the
 * resource server can look a token up in the same database the plugin wrote
 * it to, so there are no signing keys to manage, and disconnecting an app
 * (`routes/oauth-connections.ts`) takes effect on its very next request
 * instead of when a JWT happens to expire.
 */

/** Where the app is served — prod and self-host both set BETTER_AUTH_URL to it. */
export const PUBLIC_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

/** The MCP endpoint's canonical URL: the OAuth resource, and the token audience. */
export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/api/mcp`;

/** better-auth's issuer is its base URL, which includes the basePath. */
export const OAUTH_ISSUER = `${PUBLIC_ORIGIN}/api/auth`;

/**
 * RFC 9728 protected-resource metadata, at its path-inserted address (the
 * one a 401 from `/api/mcp` points to). Also served at the bare
 * `/.well-known/oauth-protected-resource` for clients that only try that.
 */
export const PROTECTED_RESOURCE_METADATA_URL = `${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;

/**
 * The scopes this server advertises: reading, changing (opt-in — see below),
 * and a refresh token to stay connected.
 *
 * `library:write` is advertised so a client knows it can ask for it, and is
 * among the scopes a client registers with by default so that asking for it
 * at authorize isn't refused. Neither of those grants anything: a token only
 * carries `library:write` when the person ticked "Allow changes" on the
 * consent screen, which starts unticked. A client registered before this
 * scope existed can't ask for it at all — its registration predates it —
 * so an existing connection never picks it up on a refresh or a re-sign-in.
 */
export const ADVERTISED_SCOPES = [MCP_SCOPE, MCP_WRITE_SCOPE, "offline_access"];

/**
 * Prefixes on the tokens handed out, so a token in a log or a config file
 * says what it is (and secret scanners can spot it). `/api/mcp` routes on
 * them: `gm_` is an API key, `gmat_` an OAuth access token.
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = "gmat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "gmrt_";

/**
 * How tokens and authorization codes are stored: SHA-256, base64url. Handed
 * to the plugin as `storeTokens`, so the plugin writes with it and
 * `verifyOAuthAccessToken` reads with it — one function, rather than this
 * file copying the plugin's private default and hoping it never changes.
 */
export function hashOAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: ADVERTISED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Game Manager",
    resource_documentation: "https://github.com/BryanSimp/game-manager-2#connect-claude",
  };
}

/**
 * Where an authorization code may be sent: Claude's connector callbacks,
 * loopback addresses (Claude Code and other local MCP clients run a server
 * on localhost for the redirect), and anything the operator lists in
 * `OAUTH_REDIRECT_URIS`.
 *
 * Dynamic client registration is unauthenticated — anyone can register a
 * client and send people a link to its consent screen. Without this list
 * that link could say any name it liked and deliver codes anywhere; with it,
 * a code only ever goes back to Claude or to the machine you're sitting at.
 */
export const CLAUDE_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

export function isAllowedRedirectUri(uri: string): boolean {
  if (CLAUDE_REDIRECT_URIS.includes(uri) || env.OAUTH_REDIRECT_URIS.includes(uri)) return true;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return loopback && (url.protocol === "http:" || url.protocol === "https:");
}

/**
 * A presented OAuth access token, checked: known, unexpired, from a client
 * that isn't disabled, and for a user. Returns that user and the token's
 * scopes — whether the scopes are *enough* is the caller's question.
 */
export async function verifyOAuthAccessToken(
  token: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const stored = hashOAuthToken(token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));
  const [row] = await db
    .select({
      userId: schema.oauthAccessToken.userId,
      scopes: schema.oauthAccessToken.scopes,
      disabled: schema.oauthClient.disabled,
    })
    .from(schema.oauthAccessToken)
    .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthAccessToken.clientId))
    .where(
      and(
        eq(schema.oauthAccessToken.token, stored),
        gt(schema.oauthAccessToken.expiresAt, new Date()),
      ),
    );
  if (!row || row.disabled || !row.userId) return null;
  return { userId: row.userId, scopes: row.scopes };
}
