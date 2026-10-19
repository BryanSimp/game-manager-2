import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { CHECKLIST_KINDS, EXTRA_LIST_KIND, MAIN_LIST_KIND } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireUser, type SessionUser } from "../plugins/auth.js";
import { logEvent } from "../services/analytics.js";
import {
  CHECKLIST_CHAPTER_MAX,
  CHECKLIST_ENTRY_MAX,
  CHECKLIST_TITLE_MAX,
  MAX_CHECKLIST_ENTRIES_PER_WRITE,
  addChecklistEntries,
  createChecklist,
  hasMainList,
  loadChecklistItems,
  nextPosition,
  setChecklistItemDone,
  setChecklistItemsDone,
} from "../services/checklists.js";
import { inspectAll } from "../services/content-filter.js";
import { replyWithServiceError } from "../services/service-error.js";
import {
  NO_VOTES,
  castChecklistVote,
  checklistVoteCounts,
  voteSchema,
  type VoteCounts,
} from "../services/votes.js";
import { publishModeFor } from "../services/preferences.js";
import { voteRateLimit } from "../plugins/rate-limits.js";

const titleSchema = z.object({
  title: z.string().min(1).max(CHECKLIST_TITLE_MAX),
  kind: z.enum(CHECKLIST_KINDS).optional(),
});
const patchSchema = z.object({
  title: z.string().min(1).max(CHECKLIST_TITLE_MAX).optional(),
  isPublic: z.boolean().optional(),
  sequential: z.boolean().optional(),
});
const itemSchema = z.object({
  // trimmed before it's measured, so "   " is refused here rather than
  // stored as a blank entry
  text: z.string().trim().min(1).max(CHECKLIST_ENTRY_MAX),
  category: z.string().max(CHECKLIST_CHAPTER_MAX).nullable().optional(),
});
const importMissionsSchema = z.object({
  title: z.string().min(1).max(CHECKLIST_TITLE_MAX),
  missions: z
    .array(z.string().min(1).max(CHECKLIST_ENTRY_MAX))
    .min(1)
    .max(MAX_CHECKLIST_ENTRIES_PER_WRITE),
  // only the main-story list feeds the time estimate; everything else is untimed
  kind: z.enum(["missions", "side_quests"]).default("missions"),
});
const bulkCheckSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(1000),
  completed: z.boolean(),
});
const itemPatchSchema = z.object({
  text: z.string().min(1).max(CHECKLIST_ENTRY_MAX).optional(),
  category: z.string().max(CHECKLIST_CHAPTER_MAX).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
const listOrderSchema = z.object({
  ids: z.array(z.string().uuid()).max(100),
});

async function getTemplate(id: string) {
  const [tpl] = await db
    .select()
    .from(schema.checklistTemplates)
    .where(eq(schema.checklistTemplates.id, id));
  return tpl ?? null;
}

/** Author sees their own; everyone sees public. */
function canView(tpl: { authorUserId: string; isPublic: boolean }, user: SessionUser) {
  return tpl.authorUserId === user.id || tpl.isPublic;
}

/**
 * Reject text that shouldn't be shared, and say which rule it hit.
 *
 * Returns true when the reply has been sent, so callers read as
 * `if (await rejectBadContent(...)) return;`.
 */
async function rejectBadContent(
  reply: FastifyReply,
  userId: string,
  texts: Array<string | null | undefined>,
): Promise<boolean> {
  const issue = inspectAll(texts);
  if (!issue) return false;
  logEvent("content_blocked", userId, { surface: "checklist", kind: issue.kind });
  await reply.status(400).send({ message: issue.message });
  return true;
}

async function summarize(
  templates: Array<typeof schema.checklistTemplates.$inferSelect>,
  user: Pick<SessionUser, "id">,
) {
  if (templates.length === 0) return [];
  const ids = templates.map((t) => t.id);
  const counts = await db
    .select({
      templateId: schema.checklistItems.templateId,
      itemCount: sql<number>`count(*)::int`,
      doneCount: sql<number>`count(${schema.userChecklistItems.userId})::int`,
    })
    .from(schema.checklistItems)
    .leftJoin(
      schema.userChecklistItems,
      and(
        eq(schema.userChecklistItems.itemId, schema.checklistItems.id),
        eq(schema.userChecklistItems.userId, user.id),
      ),
    )
    .where(inArray(schema.checklistItems.templateId, ids))
    .groupBy(schema.checklistItems.templateId);
  const byTemplate = new Map(counts.map((c) => [c.templateId, c]));

  const authorIds = [...new Set(templates.map((t) => t.authorUserId))];
  const authors = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, authorIds));
  const authorNames = new Map(authors.map((a) => [a.id, a.name]));

  const votes = await checklistVoteCounts(ids, user.id);

  return templates.map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    sourceUrl: t.sourceUrl,
    source: t.source,
    sequential: t.sequential,
    isPublic: t.isPublic,
    position: t.position,
    adoptedFromId: t.adoptedFromId,
    mine: t.authorUserId === user.id,
    authorName: t.authorUserId === user.id ? null : (authorNames.get(t.authorUserId) ?? null),
    itemCount: byTemplate.get(t.id)?.itemCount ?? 0,
    doneCount: byTemplate.get(t.id)?.doneCount ?? 0,
    votes: votes.get(t.id) ?? NO_VOTES,
  }));
}

/** Best first, then newest — the order that makes browsing worth doing. */
function byScore(a: { votes: VoteCounts }, b: { votes: VoteCounts }): number {
  return b.votes.score - a.votes.score;
}

/**
 * Your own lists for a game, in the order you arranged them, each with its
 * ticked/total counts. The `mine` half of `GET /api/games/:gameId/checklists`,
 * and what the MCP `get_game` tool reports.
 */
export async function loadMyChecklists(userId: string, gameId: string) {
  const mine = await db
    .select()
    .from(schema.checklistTemplates)
    .where(
      and(
        eq(schema.checklistTemplates.gameId, gameId),
        eq(schema.checklistTemplates.authorUserId, userId),
      ),
    )
    // createdAt breaks ties, and covers rows the 0020 backfill left at 0
    .orderBy(asc(schema.checklistTemplates.position), asc(schema.checklistTemplates.createdAt));
  return summarize(mine, { id: userId });
}

export function registerChecklistRoutes(app: FastifyInstance): void {
  /**
   * Every list for a game: yours in the order you arranged them, then other
   * people's published ones, best-rated first.
   */
  app.get<{ Params: { gameId: string } }>(
    "/api/games/:gameId/checklists",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const pub = await db
        .select()
        .from(schema.checklistTemplates)
        .where(
          and(
            eq(schema.checklistTemplates.gameId, request.params.gameId),
            eq(schema.checklistTemplates.isPublic, true),
            ne(schema.checklistTemplates.authorUserId, user.id),
          ),
        )
        .orderBy(sql`${schema.checklistTemplates.createdAt} desc`);
      return {
        mine: await loadMyChecklists(user.id, request.params.gameId),
        public: (await summarize(pub, user)).sort(byScore),
      };
    },
  );

  app.post<{ Params: { gameId: string } }>(
    "/api/games/:gameId/checklists",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = titleSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Title is required" });
      try {
        // An empty list's title is all there is to filter, so "publish
        // automatically" can apply here without a second scan. Entries added
        // later are filtered on write.
        const { checklist } = await createChecklist(
          user.id,
          request.params.gameId,
          { title: parsed.data.title, kind: parsed.data.kind ?? EXTRA_LIST_KIND },
          "preference",
        );
        reply.status(201);
        return { id: checklist.id, isPublic: checklist.isPublic };
      } catch (err) {
        return replyWithServiceError(reply, err);
      }
    },
  );

  /**
   * Rearrange your lists for a game. Full-array rewrite rather than the
   * pairwise swap the item rows use: lists get inserted and deleted often
   * enough that positions can't be assumed distinct, and a handful of lists
   * is nothing like a 70-mission renumber.
   */
  app.put<{ Params: { gameId: string } }>(
    "/api/games/:gameId/checklists/order",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = listOrderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });

      const owned = await db
        .select({ id: schema.checklistTemplates.id })
        .from(schema.checklistTemplates)
        .where(
          and(
            eq(schema.checklistTemplates.gameId, request.params.gameId),
            eq(schema.checklistTemplates.authorUserId, user.id),
          ),
        );
      const ownedIds = new Set(owned.map((o) => o.id));
      // ids you don't own are dropped rather than rejected; lists you own but
      // didn't name keep their places at the end
      const ordered = parsed.data.ids.filter((id) => ownedIds.has(id));
      const rest = owned.map((o) => o.id).filter((id) => !ordered.includes(id));
      const final = [...ordered, ...rest];

      await Promise.all(
        final.map((id, i) =>
          db
            .update(schema.checklistTemplates)
            .set({ position: i + 1 })
            .where(eq(schema.checklistTemplates.id, id)),
        ),
      );
      return { ok: true, ordered: final.length };
    },
  );

  /**
   * Create a list from entries the user already has — pasted in, or generated
   * as "Mission 1..N". This is the only bulk create path; the wiki scraper
   * that used to feed it was removed in phase 16 for being wrong more often
   * than it was right.
   */
  app.post<{ Params: { gameId: string } }>(
    "/api/games/:gameId/missions",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = importMissionsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });

      const missions = parsed.data.missions.map((m) => m.trim()).filter(Boolean);
      if (missions.length === 0) {
        return reply.status(400).send({ message: "At least one mission is required" });
      }
      try {
        const { checklist, entries } = await createChecklist(
          user.id,
          request.params.gameId,
          {
            title: parsed.data.title,
            kind: parsed.data.kind,
            entries: missions.map((text) => ({ text })),
          },
          "preference",
        );
        reply.status(201);
        return { id: checklist.id, count: entries, isPublic: checklist.isPublic };
      } catch (err) {
        return replyWithServiceError(reply, err);
      }
    },
  );

  // Template detail with items + my completion state
  app.get<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || !canView(tpl, user)) {
      return reply.status(404).send({ message: "Checklist not found" });
    }
    const items = await loadChecklistItems(user.id, tpl.id);
    let authorName: string | null = null;
    if (tpl.authorUserId !== user.id) {
      const [author] = await db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, tpl.authorUserId));
      authorName = author?.name ?? null;
    }
    return {
      id: tpl.id,
      gameId: tpl.gameId,
      title: tpl.title,
      kind: tpl.kind,
      sourceUrl: tpl.sourceUrl,
      source: tpl.source,
      sequential: tpl.sequential,
      isPublic: tpl.isPublic,
      mine: tpl.authorUserId === user.id,
      authorName,
      items,
    };
  });

  app.patch<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || tpl.authorUserId !== user.id) {
      return reply.status(404).send({ message: "Checklist not found" });
    }
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });

    // Publishing re-checks every entry, not just the fields in this request.
    // A list written before the filter existed, or built one item at a time
    // by an older client, would otherwise reach the public list on an
    // isPublic-only PATCH.
    if (parsed.data.isPublic === true) {
      // "Never publish" is a guarantee, not a default: the control is hidden
      // in both apps, and the API says no to anything that asks anyway.
      // Unpublishing is always allowed — the setting governs what goes out,
      // never what comes back.
      if ((await publishModeFor(user.id)) === "never") {
        return reply
          .status(403)
          .send({ message: "Publishing is turned off in your preferences" });
      }
      const items = await db
        .select({ text: schema.checklistItems.text, category: schema.checklistItems.category })
        .from(schema.checklistItems)
        .where(eq(schema.checklistItems.templateId, tpl.id));
      const texts = [
        parsed.data.title ?? tpl.title,
        tpl.source,
        ...items.flatMap((i) => [i.text, i.category]),
      ];
      if (await rejectBadContent(reply, user.id, texts)) return;
    } else if (await rejectBadContent(reply, user.id, [parsed.data.title])) {
      return;
    }

    await db
      .update(schema.checklistTemplates)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
        ...(parsed.data.sequential !== undefined ? { sequential: parsed.data.sequential } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.checklistTemplates.id, tpl.id));
    return { ok: true };
  });

  // Author deletes their own; admin can moderate any public template
  app.delete<{ Params: { id: string } }>("/api/checklists/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl) return reply.status(404).send({ message: "Checklist not found" });
    const allowed = tpl.authorUserId === user.id || (user.role === "admin" && tpl.isPublic);
    if (!allowed) return reply.status(403).send({ message: "Not your checklist" });
    await db.delete(schema.checklistTemplates).where(eq(schema.checklistTemplates.id, tpl.id));
    return { ok: true };
  });

  // Adopt a public template: private copy under my account, progress starts fresh
  app.post<{ Params: { id: string } }>("/api/checklists/:id/adopt", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const tpl = await getTemplate(request.params.id);
    if (!tpl || !tpl.isPublic) return reply.status(404).send({ message: "Checklist not found" });
    if (tpl.authorUserId === user.id) {
      return reply.status(400).send({ message: "This checklist is already yours" });
    }
    // A copy of someone's main story list is only useful *as* your main story
    // list — that's the one the estimate divides up. Filing it as an extra
    // instead would silently change what you copied it for.
    if (tpl.kind === MAIN_LIST_KIND && (await hasMainList(user.id, tpl.gameId))) {
      return reply.status(409).send({
        message: "You already have a main story list for this game — delete it first to copy this one",
      });
    }
    const items = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.templateId, tpl.id))
      .orderBy(asc(schema.checklistItems.position));
    const [copy] = await db
      .insert(schema.checklistTemplates)
      .values({
        gameId: tpl.gameId,
        authorUserId: user.id,
        title: tpl.title,
        kind: tpl.kind,
        // a scraped list's CC-BY-SA attribution travels with the copy, and
        // so does whatever source its author named
        sourceUrl: tpl.sourceUrl,
        source: tpl.source,
        sequential: tpl.sequential,
        // A copy always starts private — publishing someone else's work is
        // their call, not yours. "Publish automatically" does not reach here
        // either: it governs what you make, and a copy is not that.
        isPublic: false,
        adoptedFromId: tpl.id,
        position: await nextPosition(user.id, tpl.gameId),
      })
      .returning();
    if (items.length > 0) {
      await db.insert(schema.checklistItems).values(
        items.map((it) => ({
          templateId: copy!.id,
          position: it.position,
          text: it.text,
          category: it.category,
        })),
      );
    }
    reply.status(201);
    return { id: copy!.id };
  });

  /**
   * Thumb a published list up or down. Only public lists — a private list has
   * no audience — and never your own: an author voting on their own work is
   * noise, not signal.
   */
  app.put<{ Params: { id: string } }>(
    "/api/checklists/:id/vote",
    { config: voteRateLimit },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const tpl = await getTemplate(request.params.id);
      if (!tpl || !tpl.isPublic) return reply.status(404).send({ message: "Checklist not found" });
      if (tpl.authorUserId === user.id) {
        return reply.status(400).send({ message: "You can't rate your own list" });
      }
      const parsed = voteSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid vote" });
      await castChecklistVote(tpl.id, user.id, parsed.data.value);
      const counts = await checklistVoteCounts([tpl.id], user.id);
      return counts.get(tpl.id) ?? NO_VOTES;
    },
  );

  // ---- items (author only) ----

  app.post<{ Params: { id: string } }>("/api/checklists/:id/items", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = itemSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Item text is required" });
    try {
      const { added } = await addChecklistEntries(user.id, request.params.id, [parsed.data]);
      reply.status(201);
      return { id: added[0]!.id, position: added[0]!.position };
    } catch (err) {
      return replyWithServiceError(reply, err);
    }
  });

  app.patch<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [row] = await db
        .select({ item: schema.checklistItems, tpl: schema.checklistTemplates })
        .from(schema.checklistItems)
        .innerJoin(
          schema.checklistTemplates,
          eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
        )
        .where(eq(schema.checklistItems.id, request.params.itemId));
      if (!row || row.tpl.authorUserId !== user.id) {
        return reply.status(404).send({ message: "Item not found" });
      }
      const parsed = itemPatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
      if (await rejectBadContent(reply, user.id, [parsed.data.text, parsed.data.category])) return;
      await db
        .update(schema.checklistItems)
        .set({
          ...(parsed.data.text !== undefined ? { text: parsed.data.text.trim() } : {}),
          ...(parsed.data.category !== undefined
            ? { category: parsed.data.category?.trim() || null }
            : {}),
          ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
        })
        .where(eq(schema.checklistItems.id, row.item.id));
      return { ok: true };
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const [row] = await db
        .select({ item: schema.checklistItems, tpl: schema.checklistTemplates })
        .from(schema.checklistItems)
        .innerJoin(
          schema.checklistTemplates,
          eq(schema.checklistItems.templateId, schema.checklistTemplates.id),
        )
        .where(eq(schema.checklistItems.id, request.params.itemId));
      if (!row || row.tpl.authorUserId !== user.id) {
        return reply.status(404).send({ message: "Item not found" });
      }
      await db.delete(schema.checklistItems).where(eq(schema.checklistItems.id, row.item.id));
      return { ok: true };
    },
  );

  // ---- progress (own templates only — adopt public ones first) ----

  /**
   * Tick several entries at once. Sequential lists need this: marking mission
   * 70 done implies the 69 before it, and that shouldn't be 70 round trips.
   * The ticking is `setChecklistItemsDone`, shared with the MCP tool: own
   * lists only, and ids re-checked against the template so a caller can't
   * tick off someone else's list by guessing ids.
   */
  app.put<{ Params: { id: string } }>(
    "/api/checklists/:id/items/check",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = bulkCheckSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
      try {
        const { matched } = await setChecklistItemsDone(
          user.id,
          request.params.id,
          parsed.data.itemIds,
          parsed.data.completed,
        );
        // "changed" has always counted the entries on the list, ticked
        // already or not — the Progress tab refetches either way
        return { ok: true, changed: matched };
      } catch (err) {
        return replyWithServiceError(reply, err);
      }
    },
  );

  app.put<{ Params: { itemId: string } }>(
    "/api/checklists/items/:itemId/check",
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const parsed = z.object({ completed: z.boolean() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
      try {
        await setChecklistItemDone(user.id, request.params.itemId, parsed.data.completed);
        return { ok: true };
      } catch (err) {
        return replyWithServiceError(reply, err);
      }
    },
  );
}
