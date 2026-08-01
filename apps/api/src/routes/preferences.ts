import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { OWNERSHIP_FORMATS } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser } from "../plugins/auth.js";
import { isValidCategory } from "../services/categories.js";
import { rememberConsoles } from "../services/consoles.js";

const DEFAULTS = {
  theme: "dark",
  defaultStatus: "backlog",
  statusColors: null as Record<string, string> | null,
  defaultPlatformId: null as string | null,
  defaultPlatformFormat: "digital" as const,
  showPlatformBadge: true,
  showTimeBadge: true,
  badgeOpacity: 100,
};

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const prefsSchema = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  // keys are category keys — built-in or custom — so this is a plain record
  statusColors: z.record(z.string().min(1).max(64), hexColor).nullable().optional(),
  defaultStatus: z.string().min(1).max(64).optional(),
  defaultPlatformId: z.string().uuid().nullable().optional(),
  defaultPlatformFormat: z.enum(OWNERSHIP_FORMATS).optional(),
  showPlatformBadge: z.boolean().optional(),
  showTimeBadge: z.boolean().optional(),
  // floored at 20% — a badge you can't read is a badge that isn't there
  badgeOpacity: z.number().int().min(20).max(100).optional(),
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
      defaultStatus: row.defaultStatus,
      statusColors: (row.statusColors as Record<string, string> | null) ?? null,
      defaultPlatformId: row.defaultPlatformId,
      defaultPlatformFormat: row.defaultPlatformFormat,
      showPlatformBadge: row.showPlatformBadge,
      showTimeBadge: row.showTimeBadge,
      badgeOpacity: row.badgeOpacity,
    };
  });

  app.put("/api/preferences", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    if (
      parsed.data.defaultStatus !== undefined &&
      !(await isValidCategory(user.id, parsed.data.defaultStatus))
    ) {
      return reply.status(400).send({ message: "Unknown category" });
    }
    if (parsed.data.defaultPlatformId) {
      const [platform] = await db
        .select({ id: schema.platforms.id })
        .from(schema.platforms)
        .where(eq(schema.platforms.id, parsed.data.defaultPlatformId));
      if (!platform) return reply.status(400).send({ message: "Unknown platform" });
      // a default you never see in a picker would be a trap — own it
      await rememberConsoles(user.id, [platform.id]);
    }
    const values = {
      userId: user.id,
      ...(parsed.data.theme !== undefined && { theme: parsed.data.theme }),
      ...(parsed.data.defaultStatus !== undefined && {
        defaultStatus: parsed.data.defaultStatus,
      }),
      ...(parsed.data.statusColors !== undefined && { statusColors: parsed.data.statusColors }),
      ...(parsed.data.defaultPlatformId !== undefined && {
        defaultPlatformId: parsed.data.defaultPlatformId,
      }),
      ...(parsed.data.defaultPlatformFormat !== undefined && {
        defaultPlatformFormat: parsed.data.defaultPlatformFormat,
      }),
      ...(parsed.data.showPlatformBadge !== undefined && {
        showPlatformBadge: parsed.data.showPlatformBadge,
      }),
      ...(parsed.data.showTimeBadge !== undefined && { showTimeBadge: parsed.data.showTimeBadge }),
      ...(parsed.data.badgeOpacity !== undefined && { badgeOpacity: parsed.data.badgeOpacity }),
    };
    const { userId, ...updates } = values;
    await db
      .insert(schema.userPreferences)
      .values(values)
      .onConflictDoUpdate({ target: schema.userPreferences.userId, set: updates });
    return { ok: true };
  });
}
