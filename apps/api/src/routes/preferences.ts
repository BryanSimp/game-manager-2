import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { GAME_STATUSES } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";

const DEFAULTS = {
  theme: "dark",
  statusColors: null as Record<string, string> | null,
  showPlatformBadge: true,
  showTimeBadge: true,
};

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const prefsSchema = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  statusColors: z
    .partialRecord(z.enum(GAME_STATUSES), hexColor)
    .nullable()
    .optional(),
  showPlatformBadge: z.boolean().optional(),
  showTimeBadge: z.boolean().optional(),
});

export function registerPreferenceRoutes(app: FastifyInstance): void {
  app.get("/api/preferences", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const [row] = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id));
    if (!row) return DEFAULTS;
    return {
      theme: row.theme,
      statusColors: (row.statusColors as Record<string, string> | null) ?? null,
      showPlatformBadge: row.showPlatformBadge,
      showTimeBadge: row.showTimeBadge,
    };
  });

  app.put("/api/preferences", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const values = {
      userId: user.id,
      ...(parsed.data.theme !== undefined && { theme: parsed.data.theme }),
      ...(parsed.data.statusColors !== undefined && { statusColors: parsed.data.statusColors }),
      ...(parsed.data.showPlatformBadge !== undefined && {
        showPlatformBadge: parsed.data.showPlatformBadge,
      }),
      ...(parsed.data.showTimeBadge !== undefined && { showTimeBadge: parsed.data.showTimeBadge }),
    };
    const { userId, ...updates } = values;
    await db
      .insert(schema.userPreferences)
      .values(values)
      .onConflictDoUpdate({ target: schema.userPreferences.userId, set: updates });
    return { ok: true };
  });
}
