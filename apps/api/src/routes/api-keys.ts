import type { FastifyInstance } from "fastify";
import { and, count, desc, eq } from "drizzle-orm";
import {
  MAX_API_KEYS,
  apiKeyCreateSchema,
  type ApiKeySummary,
  type CreatedApiKey,
} from "@gm/shared";
import { auth } from "../auth.js";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { apiKeyRateLimit } from "../plugins/rate-limits.js";

/**
 * Personal API keys, for connecting Claude Code (or any MCP client) to
 * `/api/mcp`.
 *
 * These wrap better-auth's api-key plugin rather than letting the browser
 * call it directly (its own HTTP endpoints are refused in `server.ts`). The
 * plugin is still what generates and hashes a key — this file only decides
 * *whose* it is, from the session, and that the one thing a person chooses is
 * the name. Called that way, the plugin's server-only fields (quota, refill,
 * permissions, a custom prefix) can't be set by anybody.
 *
 * Listing and revoking read the table directly, scoped to the asking user.
 */
function toSummary(row: {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  lastRequest: Date | null;
  expiresAt: Date | null;
}): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export function registerApiKeyRoutes(app: FastifyInstance): void {
  /*
   * The plugin's own client endpoints (create/list/update/delete), shadowed.
   * Fastify matches this more specific prefix ahead of the `/api/auth/*`
   * mount — the same trick `auth-recovery.ts` uses — so the only way to make
   * a key is the route below. `auth.api.*` calls are in-process and unaffected.
   */
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/api-key/*",
    handler: async (_request, reply) => reply.status(404).send({ message: "Not found" }),
  });

  app.get("/api/api-keys", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(schema.apikey)
      .where(eq(schema.apikey.referenceId, user.id))
      .orderBy(desc(schema.apikey.createdAt));
    return rows.map(toSummary);
  });

  app.post("/api/api-keys", { config: apiKeyRateLimit }, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    // the demo tour can't write at all; an admin curating the demo acts as
    // the demo account, and a key that reads the showcase library over MCP
    // is nobody's actual use for one
    if (user.isDemo) {
      return reply.status(403).send({ message: "The demo account can't have API keys." });
    }
    const parsed = apiKeyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }

    const [held] = await db
      .select({ n: count() })
      .from(schema.apikey)
      .where(eq(schema.apikey.referenceId, user.id));
    if ((held?.n ?? 0) >= MAX_API_KEYS) {
      return reply.status(409).send({
        message: `You already have ${MAX_API_KEYS} keys — revoke one you no longer use first.`,
      });
    }

    // server-side call: no request, so the plugin takes `userId` from us
    // rather than from a session, and nothing else in the body is ours to set
    const created = await auth.api.createApiKey({
      body: { name: parsed.data.name, userId: user.id },
    });
    reply.status(201);
    const payload: CreatedApiKey = {
      ...toSummary({
        id: created.id,
        name: created.name,
        start: created.start,
        createdAt: new Date(created.createdAt),
        lastRequest: null,
        expiresAt: created.expiresAt ? new Date(created.expiresAt) : null,
      }),
      key: created.key,
    };
    return payload;
  });

  /** Revoke a key. Immediate: the next MCP request with it is a 401. */
  app.delete<{ Params: { id: string } }>("/api/api-keys/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const deleted = await db
      .delete(schema.apikey)
      .where(and(eq(schema.apikey.id, request.params.id), eq(schema.apikey.referenceId, user.id)))
      .returning({ id: schema.apikey.id });
    if (deleted.length === 0) return reply.status(404).send({ message: "Key not found" });
    return { ok: true };
  });
}
