import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MAX_CUSTOM_PROGRESS_SECONDS, OWNERSHIP_FORMATS, PROGRESS_BASES, type OwnershipFormat } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { isValidCategory } from "./categories.js";
import { rememberConsoles } from "./consoles.js";
import { ServiceError } from "./service-error.js";

/**
 * Changing a library entry — its category, rating, notes, dates, flags and
 * platforms — and removing one. Shared by the web routes (`PATCH
 * /api/library/:id`, `POST /api/library/bulk-update`, `PUT
 * /api/library/:id/platforms`, `DELETE /api/library/:id`) and the MCP
 * `update_game`, `update_games` and `delete_game` tools, so both hold an
 * entry to the same rules: a category the user may file under, ratings in
 * half stars, a finish date that isn't before the start date, and the
 * first-transition date stamps the app has always applied.
 */

/** A category key: a built-in, or the id of one of the user's custom ones. */
const categoryKey = z.string().min(1).max(64);

/** A calendar day, `YYYY-MM-DD`. Stored at noon UTC so the day reads back the same anywhere. */
const calendarDay = z.iso.date("Dates are YYYY-MM-DD");

export const entryUpdateSchema = z.object({
  status: categoryKey.optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  ttbEnabled: z.boolean().optional(),
  completed100: z.boolean().optional(),
  progressBasis: z.enum(PROGRESS_BASES).optional(),
  // The length the `custom` basis divides up, in seconds; null clears it.
  // Deliberately not tied to the basis in the same request: the figure is
  // kept when you switch to another basis, so the two are set independently.
  progressCustomSeconds: z
    .number()
    .int()
    .min(60, "A custom time needs to be at least a minute")
    .max(MAX_CUSTOM_PROGRESS_SECONDS, "That's longer than a custom time can be")
    .nullable()
    .optional(),
  // Put that length on the library card. Independent of the two above for the
  // same reason they're independent of each other: it's kept across a change
  // of basis, and only read while the basis is `custom`.
  progressCustomDisplay: z.boolean().optional(),
  // When you started and finished it. The app stamps these the first time a
  // game becomes Playing or Finished; setting one is how a wrong stamp, or a
  // game finished years before it was added, gets its real date.
  startedAt: calendarDay.nullable().optional(),
  finishedAt: calendarDay.nullable().optional(),
});
export type EntryUpdate = z.infer<typeof entryUpdateSchema>;

type EntryRow = typeof schema.userGames.$inferSelect;

/** `YYYY-MM-DD` of a stored timestamp, read in UTC — the way every date in the app is shown. */
export function dayOf(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function fromDay(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** Tomorrow in UTC — the latest day a date can be, so a time zone ahead of UTC isn't refused. */
function latestDay(): string {
  return dayOf(new Date(Date.now() + 24 * 3600 * 1000))!;
}

/**
 * Apply an update to one of the user's entries. Returns the row as it is
 * afterwards, and which dates the category change stamped (the app's
 * long-standing rule: the first move to Playing stamps `startedAt`, the first
 * move to Finished stamps `finishedAt`, and a date given in the same update
 * wins over the stamp).
 *
 * A finish date before the start date is refused when this update sets
 * either one — not when it only changes something else, so an entry that
 * already has the two the wrong way round can still be rated or recategorised
 * before anyone gets round to the dates.
 */
export async function updateLibraryEntry(
  userId: string,
  entryId: string,
  input: unknown,
): Promise<{ entry: EntryRow; stamped: Array<"startedAt" | "finishedAt"> }> {
  const parsed = entryUpdateSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(400, parsed.error.issues[0]?.message ?? "Invalid update");
  const [existing] = await db
    .select()
    .from(schema.userGames)
    .where(and(eq(schema.userGames.id, entryId), eq(schema.userGames.userId, userId)));
  if (!existing) throw new ServiceError(404, "Not found");

  const data = parsed.data;
  const patch: Partial<typeof schema.userGames.$inferInsert> = { updatedAt: new Date() };
  const stamped: Array<"startedAt" | "finishedAt"> = [];
  if (data.status !== undefined) {
    if (!(await isValidCategory(userId, data.status))) throw new ServiceError(400, "Unknown category");
    patch.status = data.status;
    // auto-stamp progress dates on first transition
    if (data.status === "playing" && !existing.startedAt && data.startedAt === undefined) {
      patch.startedAt = new Date();
      stamped.push("startedAt");
    }
    if (data.status === "finished" && !existing.finishedAt && data.finishedAt === undefined) {
      patch.finishedAt = new Date();
      stamped.push("finishedAt");
    }
  }
  if (data.rating !== undefined) patch.rating = data.rating === null ? null : String(data.rating);
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.ttbEnabled !== undefined) patch.ttbEnabled = data.ttbEnabled;
  if (data.completed100 !== undefined) patch.completed100 = data.completed100;
  if (data.progressBasis !== undefined) patch.progressBasis = data.progressBasis;
  if (data.progressCustomSeconds !== undefined) patch.progressCustomSeconds = data.progressCustomSeconds;
  if (data.progressCustomDisplay !== undefined) patch.progressCustomDisplay = data.progressCustomDisplay;

  if (data.startedAt !== undefined || data.finishedAt !== undefined) {
    for (const day of [data.startedAt, data.finishedAt]) {
      if (day && day > latestDay()) throw new ServiceError(400, `${day} hasn't happened yet`);
    }
    if (data.startedAt !== undefined) patch.startedAt = data.startedAt === null ? null : fromDay(data.startedAt);
    if (data.finishedAt !== undefined) patch.finishedAt = data.finishedAt === null ? null : fromDay(data.finishedAt);
    const started = dayOf(patch.startedAt === undefined ? existing.startedAt : patch.startedAt);
    const finished = dayOf(patch.finishedAt === undefined ? existing.finishedAt : patch.finishedAt);
    if (started && finished && finished < started) {
      throw new ServiceError(
        400,
        `It can't be finished (${finished}) before it was started (${started}). Set both dates, or clear one.`,
      );
    }
  }

  const [entry] = await db
    .update(schema.userGames)
    .set(patch)
    .where(eq(schema.userGames.id, existing.id))
    .returning();
  return { entry: entry!, stamped };
}

/** What a bulk edit can change: the library's select-mode bar, minus platforms. */
export interface BulkEntryUpdate {
  status?: string;
  ttbEnabled?: boolean;
  completed100?: boolean;
}

/**
 * Apply one change to many of the user's entries. Ids that aren't the
 * user's are skipped, never touched; `updated` is the entries that were, as
 * they were *before* the change (so a caller can tell what actually moved).
 * Dates are stamped the way a single update stamps them.
 */
export async function updateLibraryEntries(
  userId: string,
  entryIds: string[],
  input: BulkEntryUpdate,
): Promise<{ updated: Array<Pick<EntryRow, "id" | "status" | "ttbEnabled" | "completed100" | "startedAt" | "finishedAt">> }> {
  if (input.status !== undefined && !(await isValidCategory(userId, input.status))) {
    throw new ServiceError(400, "Unknown category");
  }
  if (entryIds.length === 0) return { updated: [] };
  const before = await db
    .select({
      id: schema.userGames.id,
      status: schema.userGames.status,
      ttbEnabled: schema.userGames.ttbEnabled,
      completed100: schema.userGames.completed100,
      startedAt: schema.userGames.startedAt,
      finishedAt: schema.userGames.finishedAt,
    })
    .from(schema.userGames)
    .where(and(inArray(schema.userGames.id, entryIds), eq(schema.userGames.userId, userId)));
  if (before.length === 0) return { updated: [] };
  const mine = before.map((r) => r.id);

  const patch: Partial<typeof schema.userGames.$inferInsert> = { updatedAt: new Date() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.ttbEnabled !== undefined) patch.ttbEnabled = input.ttbEnabled;
  if (input.completed100 !== undefined) patch.completed100 = input.completed100;
  await db.update(schema.userGames).set(patch).where(inArray(schema.userGames.id, mine));

  // auto-stamp progress dates on first transition, matching a single update
  if (input.status === "playing" || input.status === "finished") {
    const column = input.status === "playing" ? "startedAt" : "finishedAt";
    const missing = before.filter((r) => r[column] === null).map((r) => r.id);
    if (missing.length > 0) {
      await db
        .update(schema.userGames)
        .set(input.status === "playing" ? { startedAt: new Date() } : { finishedAt: new Date() })
        .where(inArray(schema.userGames.id, missing));
    }
  }
  return { updated: before };
}

/** One platform an entry is owned on. */
export interface Ownership {
  platformId: string;
  format: OwnershipFormat;
}

export const ownershipSchema = z.object({
  platformId: z.string().uuid(),
  format: z.enum(OWNERSHIP_FORMATS),
});

/**
 * Change which platforms one of the user's entries is owned on:
 *  - `replace` — exactly these (the web game page's PUT)
 *  - `add` — these as well, alongside what it's already on. A copy is a
 *    platform *and* a format, so adding a physical copy of a game owned
 *    digitally on the same console keeps both, as the bulk bar does
 *  - `remove` — not on these, whatever the format
 * Filing a game under a platform adds it to the user's consoles list
 * (`rememberConsoles`), as everywhere.
 */
export async function setEntryPlatforms(
  userId: string,
  entryId: string,
  platforms: Ownership[],
  mode: "replace" | "add" | "remove",
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.userGames.id })
    .from(schema.userGames)
    .where(and(eq(schema.userGames.id, entryId), eq(schema.userGames.userId, userId)));
  if (!existing) throw new ServiceError(404, "Not found");
  const targets = platforms.map((p) => p.platformId);

  await db.transaction(async (tx) => {
    if (mode === "replace") {
      await tx.delete(schema.userGamePlatforms).where(eq(schema.userGamePlatforms.userGameId, existing.id));
    } else if (mode === "remove" && targets.length > 0) {
      // removing ignores format — "not on this console" covers both copies
      await tx
        .delete(schema.userGamePlatforms)
        .where(
          and(
            eq(schema.userGamePlatforms.userGameId, existing.id),
            inArray(schema.userGamePlatforms.platformId, targets),
          ),
        );
    }
    if (mode !== "remove" && platforms.length > 0) {
      await tx
        .insert(schema.userGamePlatforms)
        .values(platforms.map((p) => ({ userGameId: existing.id, platformId: p.platformId, format: p.format })))
        .onConflictDoNothing();
    }
  });
  // filing a game under a console adds it to your consoles list
  if (mode !== "remove" && targets.length > 0) await rememberConsoles(userId, targets);
}

/**
 * Remove a game from the user's library. Its tags and platforms go with the
 * entry; what's keyed by the game rather than the entry — the user's
 * checklists for it, their own play time, links, collections listing it —
 * stays, and is back where it was if the game is added again.
 */
export async function deleteLibraryEntry(userId: string, entryId: string): Promise<void> {
  const deleted = await db
    .delete(schema.userGames)
    .where(and(eq(schema.userGames.id, entryId), eq(schema.userGames.userId, userId)))
    .returning({ id: schema.userGames.id });
  if (deleted.length === 0) throw new ServiceError(404, "Not found");
}
