import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";

/**
 * Thumbs up/down on published lists and collections.
 *
 * There is no other signal for whether someone else's mission list is worth
 * copying: the app can't know if a 74-entry GTA V list is complete or
 * invented, but the twelfth person to adopt it does.
 *
 * Counts are aggregated on read rather than kept as columns on the parent
 * row. A denormalised counter drifts the first time a delete cascades, and
 * the result sets here are small — one game's lists, or one page of public
 * collections.
 */

export interface VoteCounts {
  up: number;
  down: number;
  /** up − down; what "best first" sorts by */
  score: number;
  /** this viewer's own vote: 1, -1, or 0 for none */
  mine: number;
}

export const NO_VOTES: VoteCounts = { up: 0, down: 0, score: 0, mine: 0 };

/** +1 / -1 to vote, 0 to take it back. */
export const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

interface TallyRow {
  id: string;
  up: number;
  down: number;
  mine: number;
}

function toMap(rows: TallyRow[]): Map<string, VoteCounts> {
  return new Map(
    rows.map((r) => [r.id, { up: r.up, down: r.down, score: r.up - r.down, mine: r.mine }]),
  );
}

export async function checklistVoteCounts(
  templateIds: string[],
  userId: string,
): Promise<Map<string, VoteCounts>> {
  if (templateIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.checklistVotes.templateId,
      up: sql<number>`count(*) filter (where ${schema.checklistVotes.value} > 0)::int`,
      down: sql<number>`count(*) filter (where ${schema.checklistVotes.value} < 0)::int`,
      // at most one row per (template, user), so max() is just "mine or none"
      mine: sql<number>`coalesce(max(${schema.checklistVotes.value}) filter (where ${schema.checklistVotes.userId} = ${userId}), 0)::int`,
    })
    .from(schema.checklistVotes)
    .where(inArray(schema.checklistVotes.templateId, templateIds))
    .groupBy(schema.checklistVotes.templateId);
  return toMap(rows);
}

export async function collectionVoteCounts(
  collectionIds: string[],
  userId: string,
): Promise<Map<string, VoteCounts>> {
  if (collectionIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.collectionVotes.collectionId,
      up: sql<number>`count(*) filter (where ${schema.collectionVotes.value} > 0)::int`,
      down: sql<number>`count(*) filter (where ${schema.collectionVotes.value} < 0)::int`,
      mine: sql<number>`coalesce(max(${schema.collectionVotes.value}) filter (where ${schema.collectionVotes.userId} = ${userId}), 0)::int`,
    })
    .from(schema.collectionVotes)
    .where(inArray(schema.collectionVotes.collectionId, collectionIds))
    .groupBy(schema.collectionVotes.collectionId);
  return toMap(rows);
}

/** Clearing a vote deletes the row — a stored zero would count as a voter. */
export async function castChecklistVote(
  templateId: string,
  userId: string,
  value: number,
): Promise<void> {
  if (value === 0) {
    await db
      .delete(schema.checklistVotes)
      .where(
        and(
          eq(schema.checklistVotes.templateId, templateId),
          eq(schema.checklistVotes.userId, userId),
        ),
      );
    return;
  }
  await db
    .insert(schema.checklistVotes)
    .values({ templateId, userId, value })
    .onConflictDoUpdate({
      target: [schema.checklistVotes.templateId, schema.checklistVotes.userId],
      set: { value },
    });
}

export async function castCollectionVote(
  collectionId: string,
  userId: string,
  value: number,
): Promise<void> {
  if (value === 0) {
    await db
      .delete(schema.collectionVotes)
      .where(
        and(
          eq(schema.collectionVotes.collectionId, collectionId),
          eq(schema.collectionVotes.userId, userId),
        ),
      );
    return;
  }
  await db
    .insert(schema.collectionVotes)
    .values({ collectionId, userId, value })
    .onConflictDoUpdate({
      target: [schema.collectionVotes.collectionId, schema.collectionVotes.userId],
      set: { value },
    });
}
