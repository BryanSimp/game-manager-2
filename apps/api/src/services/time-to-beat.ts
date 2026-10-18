import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeTtb, type TtbTriple } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { logEvent } from "./analytics.js";
import { ServiceError } from "./service-error.js";

/**
 * Recording how long a game took *you* — `PUT /api/library/:id/time-to-beat`
 * and the MCP `set_time_to_beat` tool, through one function.
 *
 * This used to write the shared catalog row, on the reasoning that a game's
 * length is a fact about the game rather than about you. It is — but the
 * app is public now, so "shared row, last writer wins" meant one person's
 * typo silently became everyone's number, and there was nothing left to
 * average. Submissions are per-user; `resolveTtb` picks what to show, and
 * `communityTimes` averages the rest.
 */

/**
 * Seconds. A day is already a stretch for a single figure; the cap (1,000
 * hours) is there to catch a stray "3600" typed into a field that wanted
 * hours.
 */
export const MAX_TTB_SECONDS = 60 * 60 * 1000;
const seconds = z.number().int().min(0).max(MAX_TTB_SECONDS).nullable();
const ttbInputSchema = z.object({
  ttbMain: seconds.optional(),
  ttbMainExtra: seconds.optional(),
  ttbCompletionist: seconds.optional(),
});

/**
 * Merge a submission into the user's own figures for one library entry.
 *
 * An omitted key keeps what you had; an explicit null clears it, and
 * clearing them all removes your submission entirely. `normalizeTtb`
 * enforces main <= main+extras <= completionist, the same as on ingest, so a
 * typo can't invert the columns. Returns what's stored afterwards.
 */
export async function setTimeToBeat(
  userId: string,
  entryId: string,
  input: unknown,
): Promise<{ gameId: string; times: TtbTriple; cleared: boolean }> {
  const entry = await db.query.userGames.findFirst({
    where: (ug, { and: andW, eq: eqW }) => andW(eqW(ug.id, entryId), eqW(ug.userId, userId)),
    columns: { gameId: true },
  });
  if (!entry) throw new ServiceError(404, "Not found");

  const parsed = ttbInputSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(400, "Invalid times");

  const [mine] = await db
    .select()
    .from(schema.userTimeToBeat)
    .where(
      and(eq(schema.userTimeToBeat.userId, userId), eq(schema.userTimeToBeat.gameId, entry.gameId)),
    );

  const merged = normalizeTtb({
    ttbMain: parsed.data.ttbMain === undefined ? (mine?.mainSeconds ?? null) : parsed.data.ttbMain,
    ttbMainExtra:
      parsed.data.ttbMainExtra === undefined
        ? (mine?.mainExtraSeconds ?? null)
        : parsed.data.ttbMainExtra,
    ttbCompletionist:
      parsed.data.ttbCompletionist === undefined
        ? (mine?.completionistSeconds ?? null)
        : parsed.data.ttbCompletionist,
  });

  const hasAny =
    merged.ttbMain != null || merged.ttbMainExtra != null || merged.ttbCompletionist != null;

  if (!hasAny) {
    await db
      .delete(schema.userTimeToBeat)
      .where(
        and(
          eq(schema.userTimeToBeat.userId, userId),
          eq(schema.userTimeToBeat.gameId, entry.gameId),
        ),
      );
    // The one way back for a catalog row a previous version let someone
    // pin by hand: nothing else writes `games.ttb_*` any more, so clearing
    // your submission also clears a stale manual override rather than
    // leaving it uncorrectable forever. IGDB's own figures are left alone.
    await db
      .update(schema.games)
      .set({ ttbMain: null, ttbMainExtra: null, ttbCompletionist: null, ttbSource: null })
      .where(and(eq(schema.games.id, entry.gameId), eq(schema.games.ttbSource, "manual")));
    return { gameId: entry.gameId, times: merged, cleared: true };
  }

  await db
    .insert(schema.userTimeToBeat)
    .values({
      userId,
      gameId: entry.gameId,
      mainSeconds: merged.ttbMain,
      mainExtraSeconds: merged.ttbMainExtra,
      completionistSeconds: merged.ttbCompletionist,
    })
    .onConflictDoUpdate({
      target: [schema.userTimeToBeat.userId, schema.userTimeToBeat.gameId],
      set: {
        mainSeconds: merged.ttbMain,
        mainExtraSeconds: merged.ttbMainExtra,
        completionistSeconds: merged.ttbCompletionist,
        updatedAt: new Date(),
      },
    });
  logEvent("time_submitted", userId, { gameId: entry.gameId });
  return { gameId: entry.gameId, times: merged, cleared: false };
}
