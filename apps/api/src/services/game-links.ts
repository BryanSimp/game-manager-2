import { and, eq, max, or } from "drizzle-orm";
import { GAME_LINK_ROLES, GAME_LINK_ROLE_META, type GameLinkRole } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { ServiceError } from "./service-error.js";

/**
 * Making a link between two games — the rules behind `POST
 * /api/games/:gameId/links`, shared with the MCP `link_games` tool so the
 * two can't disagree about what counts as a duplicate.
 */

/** Which role a stored row plays on the page of the game at `side` of it. */
export function roleFor(kind: string, side: "base" | "related"): GameLinkRole | null {
  return (
    GAME_LINK_ROLES.find(
      (role) => GAME_LINK_ROLE_META[role].kind === kind && GAME_LINK_ROLE_META[role].side === side,
    ) ?? null
  );
}

/**
 * Link `relatedGameId` to `gameId` as `role` — what the related game is *to*
 * this one: its DLC, its prequel, its sequel, a remake of it, or (from the
 * other side) the base game it's DLC for or the original it remakes. Each
 * role maps to one kind and one end of the row (`GAME_LINK_ROLE_META`), so
 * adding a prequel on Half-Life 2 and a sequel on Half-Life store the same
 * thing, and a pair can't end up recorded twice with the games swapped.
 *
 * Both are catalog ids, and neither has to be in the library — noting that a
 * DLC exists is useful before you buy it. `created` is false when the same
 * link was already there, which is not an error.
 */
export async function linkGames(
  userId: string,
  gameId: string,
  relatedGameId: string,
  role: GameLinkRole,
): Promise<{ id: string | null; created: boolean }> {
  const [game] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, gameId));
  if (!game) throw new ServiceError(404, "Game not found");
  if (relatedGameId === game.id) throw new ServiceError(400, "A game can't be linked to itself");
  const [related] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, relatedGameId));
  if (!related) throw new ServiceError(404, "Game not found");

  // the role names the game being added; storage is always base → related
  const meta = GAME_LINK_ROLE_META[role];
  const base = meta.side === "base" ? game.id : related.id;
  const relatedId = meta.side === "base" ? related.id : game.id;

  // One link per pair. The same link again is a no-op; any *other* link
  // between the two — the inverse (a game that's both prequel and sequel of
  // another renders as listing itself) or a second kind (DLC and a sequel
  // at once) — is refused and named, so the fix is "unlink that one" rather
  // than two sections quietly disagreeing about what the pair is.
  const existing = await db
    .select({
      id: schema.userGameLinks.id,
      gameId: schema.userGameLinks.gameId,
      kind: schema.userGameLinks.kind,
    })
    .from(schema.userGameLinks)
    .where(
      and(
        eq(schema.userGameLinks.userId, userId),
        or(
          and(
            eq(schema.userGameLinks.gameId, base),
            eq(schema.userGameLinks.relatedGameId, relatedId),
          ),
          and(
            eq(schema.userGameLinks.gameId, relatedId),
            eq(schema.userGameLinks.relatedGameId, base),
          ),
        ),
      ),
    );
  const same = existing.find((l) => l.gameId === base && l.kind === meta.kind);
  if (same) return { id: same.id, created: false };
  if (existing[0]) {
    const current = roleFor(existing[0].kind, existing[0].gameId === game.id ? "base" : "related");
    throw new ServiceError(
      409,
      current
        ? `Those two are already linked — it's under ${GAME_LINK_ROLE_META[current].section}. Unlink it there first to change how they're related.`
        : "Those two are already linked. Unlink them first to change how they're related.",
    );
  }

  // new links go on the end of both lists they join, so a section already
  // in custom order keeps the order you gave it
  const [[baseMax], [relatedMax]] = await Promise.all([
    db
      .select({ value: max(schema.userGameLinks.basePosition) })
      .from(schema.userGameLinks)
      .where(
        and(
          eq(schema.userGameLinks.userId, userId),
          eq(schema.userGameLinks.gameId, base),
          eq(schema.userGameLinks.kind, meta.kind),
        ),
      ),
    db
      .select({ value: max(schema.userGameLinks.relatedPosition) })
      .from(schema.userGameLinks)
      .where(
        and(
          eq(schema.userGameLinks.userId, userId),
          eq(schema.userGameLinks.relatedGameId, relatedId),
          eq(schema.userGameLinks.kind, meta.kind),
        ),
      ),
  ]);

  const [created] = await db
    .insert(schema.userGameLinks)
    .values({
      userId,
      gameId: base,
      relatedGameId: relatedId,
      kind: meta.kind,
      basePosition: (baseMax?.value ?? 0) + 1,
      relatedPosition: (relatedMax?.value ?? 0) + 1,
    })
    // two clicks racing each other: the second finds the first's row
    .onConflictDoNothing()
    .returning({ id: schema.userGameLinks.id });
  return { id: created?.id ?? null, created: !!created };
}

/**
 * Remove whatever link there is between two games — the MCP `unlink_games`
 * tool, which names games rather than a link id (the web app's `DELETE
 * /api/games/:gameId/links/:linkId` has the row in hand). A pair is stored
 * once, in one direction, so this looks both ways; there's normally one row,
 * but a pair linked before one-link-per-pair was enforced can have more, and
 * all of them go. Each comes back as the role `relatedGameId` played on
 * `gameId`'s page, so the caller can say what was undone.
 */
export async function unlinkGames(
  userId: string,
  gameId: string,
  relatedGameId: string,
): Promise<Array<{ id: string; role: GameLinkRole | null }>> {
  const deleted = await db
    .delete(schema.userGameLinks)
    .where(
      and(
        eq(schema.userGameLinks.userId, userId),
        or(
          and(eq(schema.userGameLinks.gameId, gameId), eq(schema.userGameLinks.relatedGameId, relatedGameId)),
          and(eq(schema.userGameLinks.gameId, relatedGameId), eq(schema.userGameLinks.relatedGameId, gameId)),
        ),
      ),
    )
    .returning({
      id: schema.userGameLinks.id,
      gameId: schema.userGameLinks.gameId,
      kind: schema.userGameLinks.kind,
    });
  return deleted.map((row) => ({
    id: row.id,
    role: roleFor(row.kind, row.gameId === gameId ? "base" : "related"),
  }));
}
