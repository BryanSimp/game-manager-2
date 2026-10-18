import type { FastifyInstance } from "fastify";
import { and, desc, eq, max } from "drizzle-orm";
import type { OAuthConnection } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";

/**
 * Apps you've let read your library through OAuth (claude.ai's connector,
 * mostly), and the way to take that back.
 *
 * A connection is a consent row: "this client, these scopes, this person".
 * Disconnecting deletes the consent *and* every access and refresh token the
 * client holds for you — the consent alone would only make the next sign-in
 * ask again, while a refresh token kept the app reading for a month. Tokens
 * are looked up per request (`services/oauth.ts`), so the cut is immediate.
 *
 * The oauth-provider plugin has consent endpoints of its own; they're
 * disabled over HTTP (`auth.ts`), and this is the scoped replacement.
 */
export function registerOAuthConnectionRoutes(app: FastifyInstance): void {
  app.get("/api/oauth-connections", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select({
        clientId: schema.oauthConsent.clientId,
        scopes: schema.oauthConsent.scopes,
        connectedAt: schema.oauthConsent.createdAt,
        name: schema.oauthClient.name,
        uri: schema.oauthClient.uri,
        redirectUris: schema.oauthClient.redirectUris,
      })
      .from(schema.oauthConsent)
      .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
      .where(eq(schema.oauthConsent.userId, user.id))
      .orderBy(desc(schema.oauthConsent.createdAt));

    // when each app last got a token: a refresh every hour while it's in use,
    // so this is "last active" to within the hour
    const lastTokens = await db
      .select({
        clientId: schema.oauthAccessToken.clientId,
        at: max(schema.oauthAccessToken.createdAt),
      })
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.userId, user.id))
      .groupBy(schema.oauthAccessToken.clientId);
    const lastByClient = new Map(lastTokens.map((t) => [t.clientId, t.at]));

    return rows.map(
      (r): OAuthConnection => ({
        clientId: r.clientId,
        name: r.name,
        uri: r.uri,
        // where its codes go — the one thing about a self-registered client
        // that the allowlist guarantees is true
        redirectHost: hostOf(r.redirectUris?.[0]),
        scopes: r.scopes,
        connectedAt: r.connectedAt?.toISOString() ?? null,
        lastActiveAt: lastByClient.get(r.clientId)?.toISOString() ?? null,
      }),
    );
  });

  app.delete<{ Params: { clientId: string } }>(
    "/api/oauth-connections/:clientId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { clientId } = request.params;
      const removed = await db.transaction(async (tx) => {
        const consents = await tx
          .delete(schema.oauthConsent)
          .where(
            and(eq(schema.oauthConsent.clientId, clientId), eq(schema.oauthConsent.userId, user.id)),
          )
          .returning({ id: schema.oauthConsent.id });
        // access tokens first: they reference the refresh tokens
        await tx
          .delete(schema.oauthAccessToken)
          .where(
            and(
              eq(schema.oauthAccessToken.clientId, clientId),
              eq(schema.oauthAccessToken.userId, user.id),
            ),
          );
        await tx
          .delete(schema.oauthRefreshToken)
          .where(
            and(
              eq(schema.oauthRefreshToken.clientId, clientId),
              eq(schema.oauthRefreshToken.userId, user.id),
            ),
          );
        return consents.length;
      });
      if (removed === 0) return reply.status(404).send({ message: "Not connected" });
      return { ok: true };
    },
  );
}

function hostOf(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}
