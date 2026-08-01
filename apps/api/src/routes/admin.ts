import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../plugins/auth.js";
import { getIgdbCredentials, setSetting } from "../services/settings.js";
import { igdbTest } from "../services/igdb.js";
import { steamConfigured } from "../services/steam.js";
import { getSteamGridDbKey } from "../services/steamgriddb.js";

const igdbSchema = z.object({
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(200),
});

const steamSchema = z.object({ apiKey: z.string().min(1).max(200) });
const sgdbSchema = z.object({ apiKey: z.string().min(1).max(200) });

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get("/api/admin/settings", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const creds = await getIgdbCredentials();
    return {
      igdbConfigured: creds !== null,
      igdbClientId: creds ? `${creds.clientId.slice(0, 4)}…` : null,
      steamConfigured: await steamConfigured(),
      steamGridDbConfigured: !!(await getSteamGridDbKey()),
    };
  });

  /** SteamGridDB key — powers the alternate-cover browser on game pages. */
  app.put("/api/admin/settings/steamgriddb", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = sgdbSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "An API key is required" });
    await setSetting("steamgriddb_api_key", parsed.data.apiKey.trim());
    return { ok: true };
  });

  app.put("/api/admin/settings/steam", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = steamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    await setSetting("steam_api_key", parsed.data.apiKey.trim());
    return { ok: true };
  });

  app.put("/api/admin/settings/igdb", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = igdbSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    await setSetting("igdb_client_id", parsed.data.clientId.trim());
    await setSetting("igdb_client_secret", parsed.data.clientSecret.trim());
    return { ok: true };
  });

  app.post("/api/admin/settings/igdb/test", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    try {
      await igdbTest();
      return { ok: true };
    } catch (err) {
      return reply
        .status(400)
        .send({ message: err instanceof Error ? err.message : "IGDB test failed" });
    }
  });
}
