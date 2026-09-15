import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  GAME_LINK_ROLES,
  GAME_LINK_ROLE_META,
  type GameLink,
  type GameLinkRole,
  type GameLinkSection,
  type GameLinkSort,
  type GameLinks,
  type LinkedGame,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { statusChip, statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";
import { Dropdown, DropdownItem, DropdownLabel } from "./Dropdown.js";

/** the four you add to a game, in the order they were asked for */
const PRIMARY_ROLES = GAME_LINK_ROLES.filter((role) => GAME_LINK_ROLE_META[role].primary);
/** the two that say what a game belongs to, which only matter on some games */
const BELONGS_TO_ROLES = GAME_LINK_ROLES.filter((role) => !GAME_LINK_ROLE_META[role].primary);

/**
 * One game's links. Every page that shows them shares this key, so linking
 * from one game refreshes the other game's cached page too — which is the
 * point, since the link shows on both.
 */
export function useGameLinks(gameId: string | undefined) {
  return useQuery({
    queryKey: ["game-links", gameId],
    queryFn: () => api.getGameLinks(gameId!),
    enabled: !!gameId,
  });
}

export function linkCount(links: GameLinks | undefined): number {
  return links?.sections.reduce((total, section) => total + section.links.length, 0) ?? 0;
}

/**
 * The Linked tab: DLC, prequels, sequels and remakes, each its own section
 * with its own order.
 *
 * A link is stored once and read from both ends, so everything here shows up
 * on the other game's Linked tab too — as its base game, its sequel, its
 * original — whether or not you own either of them. That's why this panel
 * works the same on `/catalog/$gameId` as on a game in your library.
 *
 * The four sections you add to are always drawn, empty or not: this is a page
 * for managing links, and an empty "Sequels" is how you learn that sequels are
 * a thing you can add. "Base game" and "Original" only appear once something
 * fills them — most games are neither DLC nor a remake, and two permanently
 * empty sections saying so would be noise. Both are still in the add menu.
 */
export function LinkedGamesPanel({
  gameId,
  igdbId,
  title,
}: {
  gameId: string;
  igdbId: number | null;
  title: string;
}) {
  const links = useGameLinks(gameId);
  const [picking, setPicking] = useState<GameLinkRole | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const sections = links.data?.sections ?? [];

  // what every linked game is already filed under, so the picker can say
  // "✓ Sequels" instead of offering a link the API would refuse
  const filedUnder = useMemo(() => {
    const byGame = new Map<string, GameLinkRole>();
    const byIgdb = new Map<number, GameLinkRole>();
    for (const section of sections) {
      for (const link of section.links) {
        byGame.set(link.game.id, section.role);
        if (link.game.igdbId) byIgdb.set(link.game.igdbId, section.role);
      }
    }
    return { byGame, byIgdb };
  }, [sections]);

  function startPicking(role: GameLinkRole) {
    setPicking(role);
    // a section's own "+ Add" can be well below the picker, which opens at the top
    requestAnimationFrame(() =>
      pickerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-start gap-3">
        <p className="mr-auto max-w-2xl text-sm text-zinc-400">
          What this game connects to — its DLC, the games before and after it, and any remake or
          remaster. A link shows up on both games, whether or not you own them, and your links are
          only yours.
        </p>
        <AddLinkMenu onPick={startPicking} />
      </div>

      {picking && (
        <div ref={pickerRef}>
          <LinkPicker
            gameId={gameId}
            igdbId={igdbId}
            title={title}
            role={picking}
            onRoleChange={setPicking}
            filedUnder={filedUnder}
            onClose={() => setPicking(null)}
          />
        </div>
      )}

      {links.isLoading && <p className="mt-6 text-sm text-zinc-500">Loading links…</p>}
      {links.isError && (
        <p className="mt-6 text-sm text-red-400">Couldn't load this game's links.</p>
      )}

      <div className="mt-6 space-y-3">
        {sections
          .filter((section) => GAME_LINK_ROLE_META[section.role].primary || section.links.length > 0)
          .map((section) => (
            <LinkSection
              key={section.role}
              gameId={gameId}
              section={section}
              onAdd={() => startPicking(section.role)}
            />
          ))}
      </div>
    </div>
  );
}

/**
 * "What are you linking?" as a menu rather than a wall of options. Picking a
 * role opens the search already set to it, so the choice is made once and the
 * search can take as many games as you like.
 */
function AddLinkMenu({ onPick }: { onPick: (role: GameLinkRole) => void }) {
  return (
    <Dropdown
      label="＋ Add a link"
      align="right"
      widthClassName="w-72"
      buttonClassName="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
    >
      {(close) => (
        <>
          <DropdownLabel>Link a game as this one's…</DropdownLabel>
          {PRIMARY_ROLES.map((role) => (
            <DropdownItem
              key={role}
              hint={GAME_LINK_ROLE_META[role].hint}
              onSelect={() => {
                close();
                onPick(role);
              }}
            >
              {GAME_LINK_ROLE_META[role].singular}
            </DropdownItem>
          ))}
          <div className="mx-2 my-1.5 border-t border-zinc-800" />
          <DropdownLabel>…or say what it belongs to</DropdownLabel>
          {BELONGS_TO_ROLES.map((role) => (
            <DropdownItem
              key={role}
              hint={GAME_LINK_ROLE_META[role].hint}
              onSelect={() => {
                close();
                onPick(role);
              }}
            >
              {GAME_LINK_ROLE_META[role].singular}
            </DropdownItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

/**
 * Search for games to link, and link as many as you like without reopening
 * anything — a game with five DLC is five clicks, not five trips through a
 * form. Each result says what it's already filed under instead of offering a
 * link the API would refuse.
 *
 * Library first, IGDB underneath, the same shape as the collection picker:
 * the thing you're linking is usually already in your library, but an add-on
 * you haven't bought is worth noting. Results only appear once you type —
 * a list of six arbitrary library games before you've asked for anything
 * isn't a suggestion, it's clutter.
 */
function LinkPicker({
  gameId,
  igdbId,
  title,
  role,
  onRoleChange,
  filedUnder,
  onClose,
}: {
  gameId: string;
  igdbId: number | null;
  title: string;
  role: GameLinkRole;
  onRoleChange: (role: GameLinkRole) => void;
  filedUnder: { byGame: Map<string, GameLinkRole>; byIgdb: Map<number, GameLinkRole> };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const igdb = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: query.length >= 2,
  });

  const add = useMutation({
    mutationFn: (target: { key: string; title: string; relatedGameId?: string; igdbId?: number }) =>
      api.addGameLink(gameId, {
        role,
        ...(target.relatedGameId
          ? { relatedGameId: target.relatedGameId }
          : { igdbId: target.igdbId! }),
      }),
    onMutate: () => setError(null),
    onSuccess: (_result, target) => {
      setLinked((prev) => [...prev, target.title]);
      // the prefix, not this game's key: the other game's page shows it too
      queryClient.invalidateQueries({ queryKey: ["game-links"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't link that game"),
  });

  const meta = GAME_LINK_ROLE_META[role];
  // every word, in any order: "zelda tears" should find "The Legend of Zelda:
  // Tears of the Kingdom", which a plain substring match doesn't
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const mine =
    query.length >= 2
      ? (library.data ?? [])
          // linking a game to itself is refused by the API; don't offer it
          .filter((e) => e.game.id !== gameId)
          .filter((e) => {
            const title = e.game.title.toLowerCase();
            return words.every((word) => title.includes(word));
          })
          .slice(0, 6)
      : [];
  // de-duplicate IGDB against the library by id, not title: a remake and its
  // original often share one, and hiding the second is exactly wrong here
  const mineIds = new Set(mine.map((e) => e.game.id));
  const mineIgdb = new Set(mine.map((e) => e.game.igdbId).filter((id) => id !== null));
  const external = (igdb.data?.results ?? [])
    .filter((r) => !(r.gameId && (r.gameId === gameId || mineIds.has(r.gameId))))
    .filter((r) => !(r.igdbId && (r.igdbId === igdbId || mineIgdb.has(r.igdbId))))
    .slice(0, 8);

  const pendingKey = add.isPending ? add.variables?.key : null;

  return (
    <div className="mt-4 max-w-2xl rounded-xl border border-indigo-900/60 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="link-role" className="text-sm text-zinc-400">
          Linking as
        </label>
        <select
          id="link-role"
          value={role}
          onChange={(ev) => onRoleChange(ev.target.value as GameLinkRole)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm font-medium text-zinc-100 outline-none focus:border-indigo-500"
        >
          <optgroup label="This game's…">
            {PRIMARY_ROLES.map((r) => (
              <option key={r} value={r}>
                {GAME_LINK_ROLE_META[r].singular}
              </option>
            ))}
          </optgroup>
          <optgroup label="What this game belongs to">
            {BELONGS_TO_ROLES.map((r) => (
              <option key={r} value={r}>
                {GAME_LINK_ROLE_META[r].singular}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="text-xs text-zinc-500">{meta.hint}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Done
        </button>
      </div>

      <input
        ref={inputRef}
        value={input}
        onChange={(ev) => {
          setInput(ev.target.value);
          // the last refusal was about a different game
          setError(null);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") onClose();
        }}
        placeholder={`Search for a game to link to ${title}…`}
        aria-label="Search your library or IGDB"
        className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {linked.length > 0 && !error && (
        <p className="mt-2 text-xs text-emerald-400">
          ✓ Linked {linked[linked.length - 1]}
          {linked.length > 1 ? ` (${linked.length} so far)` : ""} — pick another, or press Done.
        </p>
      )}

      <div className="mt-2 max-h-80 overflow-y-auto">
        {query.length < 2 ? (
          <p className="px-1 py-2 text-xs text-zinc-500">
            Type at least two letters. Games you don't own can be linked too — they won't be added
            to your library.
          </p>
        ) : (
          <>
            {mine.length > 0 && <GroupLabel>In your library</GroupLabel>}
            {mine.map((e) => {
              const key = `game:${e.game.id}`;
              return (
                <PickRow
                  key={key}
                  title={e.game.title}
                  year={e.game.releaseDate ? Number(e.game.releaseDate.slice(0, 4)) : null}
                  coverSrc={e.game.coverSrc}
                  filedUnder={filedUnder.byGame.get(e.game.id) ?? null}
                  pending={pendingKey === key}
                  busy={add.isPending}
                  onLink={() => add.mutate({ key, title: e.game.title, relatedGameId: e.game.id })}
                />
              );
            })}

            <GroupLabel>
              From IGDB{" "}
              <span className="font-normal text-zinc-600 normal-case">
                · linked only, not added to your library
              </span>
            </GroupLabel>
            {igdb.isLoading && <p className="px-1 py-2 text-xs text-zinc-500">Searching…</p>}
            {!igdb.isLoading && external.length === 0 && (
              <p className="px-1 py-2 text-xs text-zinc-500">No other matches.</p>
            )}
            {external.map((r) => {
              const key = r.gameId ? `game:${r.gameId}` : `igdb:${r.igdbId}`;
              const already = r.gameId
                ? filedUnder.byGame.get(r.gameId)
                : r.igdbId
                  ? filedUnder.byIgdb.get(r.igdbId)
                  : undefined;
              return (
                <PickRow
                  key={key}
                  title={r.title}
                  year={r.releaseYear}
                  coverSrc={r.coverSrc}
                  filedUnder={already ?? null}
                  pending={pendingKey === key}
                  busy={add.isPending}
                  onLink={() =>
                    add.mutate(
                      r.gameId
                        ? { key, title: r.title, relatedGameId: r.gameId }
                        : { key, title: r.title, igdbId: r.igdbId! },
                    )
                  }
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function PickRow({
  title,
  year,
  coverSrc,
  filedUnder,
  pending,
  busy,
  onLink,
}: {
  title: string;
  year: number | null;
  coverSrc: string | null;
  filedUnder: GameLinkRole | null;
  pending: boolean;
  busy: boolean;
  onLink: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-zinc-800/60">
      <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
        {coverSrc && <img src={coverSrc} alt="" className="h-full w-full object-cover" />}
      </div>
      {/* two lines, not an ellipsis: DLC is usually named "<base game> - <the
          bit that differs>", so truncating leaves five identical rows */}
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-zinc-200" title={title}>
        {title}
        {year ? <span className="text-zinc-500"> ({year})</span> : null}
      </span>
      {filedUnder ? (
        <span className="flex-none text-xs font-medium text-emerald-400">
          ✓ {GAME_LINK_ROLE_META[filedUnder].section}
        </span>
      ) : (
        <button
          onClick={onLink}
          disabled={busy}
          className="flex-none rounded-lg border border-indigo-500/50 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
        >
          {pending ? "Linking…" : "+ Link"}
        </button>
      )}
    </div>
  );
}

/** Replace one section in the cached payload — the optimistic half of a sort or reorder. */
function patchSection(
  queryClient: QueryClient,
  gameId: string,
  role: GameLinkRole,
  change: (section: GameLinkSection) => GameLinkSection,
) {
  queryClient.setQueryData<GameLinks>(["game-links", gameId], (current) =>
    current
      ? {
          ...current,
          sections: current.sections.map((s) => (s.role === role ? change(s) : s)),
        }
      : current,
  );
}

/**
 * One role's links, with its own order.
 *
 * Release date or custom is chosen per section and remembered on the server,
 * so a series' sequels can sit in release order while its DLC sits in the
 * order you play them. In custom order the arrows save as you click — there's
 * no draft to lose, because a section is a handful of games, not a marathon.
 */
function LinkSection({
  gameId,
  section,
  onAdd,
}: {
  gameId: string;
  section: GameLinkSection;
  onAdd: () => void;
}) {
  const queryClient = useQueryClient();
  const meta = GAME_LINK_ROLE_META[section.role];
  const orderKey = ["game-link-order", gameId, section.role];

  // Rapid clicks mean overlapping requests; refetching after each would snap
  // the list back to an older order mid-sequence. Only the last one in flight
  // refetches.
  function settle() {
    if (queryClient.isMutating({ mutationKey: orderKey }) === 1) {
      queryClient.invalidateQueries({ queryKey: ["game-links", gameId] });
    }
  }

  const setSort = useMutation({
    mutationKey: orderKey,
    mutationFn: (sort: GameLinkSort) => api.setGameLinkSort(gameId, { role: section.role, sort }),
    onMutate: async (sort) => {
      await queryClient.cancelQueries({ queryKey: ["game-links", gameId] });
      patchSection(queryClient, gameId, section.role, (s) => ({ ...s, sort }));
    },
    onSettled: settle,
  });

  const reorder = useMutation({
    mutationKey: orderKey,
    mutationFn: (linkIds: string[]) =>
      api.saveGameLinkOrder(gameId, { role: section.role, linkIds }),
    onMutate: async (linkIds) => {
      await queryClient.cancelQueries({ queryKey: ["game-links", gameId] });
      patchSection(queryClient, gameId, section.role, (s) => {
        const byId = new Map(s.links.map((l) => [l.id, l]));
        return {
          ...s,
          sort: "custom",
          links: linkIds.map((id) => byId.get(id)).filter((l): l is GameLink => !!l),
        };
      });
    },
    onSettled: settle,
  });

  function move(index: number, delta: number) {
    const ids = section.links.map((l) => l.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  }

  const count = section.links.length;
  const custom = section.sort === "custom";
  const failed = setSort.error ?? reorder.error;

  return (
    <section
      aria-labelledby={`links-${section.role}`}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`links-${section.role}`} className="mr-auto text-sm font-semibold text-zinc-200">
          {meta.section}
          {count > 0 && <span className="ml-2 text-xs font-normal text-zinc-500">{count}</span>}
        </h3>
        {count > 1 && (
          <div
            role="group"
            aria-label={`Order ${meta.section.toLowerCase()} by`}
            className="flex overflow-hidden rounded-lg border border-zinc-700 text-xs"
          >
            {(["release", "custom"] as const).map((sort) => (
              <button
                key={sort}
                aria-pressed={section.sort === sort}
                onClick={() => section.sort !== sort && setSort.mutate(sort)}
                className={`px-2.5 py-1 transition ${
                  section.sort === sort
                    ? "bg-indigo-600/25 font-medium text-indigo-200"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {sort === "release" ? "Release date" : "Custom order"}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onAdd}
          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          + Add
        </button>
      </div>

      {count === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">
          {section.role === "dlc"
            ? "No DLC linked yet."
            : `No ${meta.section.toLowerCase()} linked yet.`}
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {section.links.map((link, index) => (
            <LinkRow
              key={link.id}
              gameId={gameId}
              link={link}
              number={count > 1 ? index + 1 : null}
              onMove={custom && count > 1 ? (delta) => move(index, delta) : undefined}
              isFirst={index === 0}
              isLast={index === count - 1}
            />
          ))}
        </ol>
      )}

      {custom && count > 1 && (
        <p className="mt-2 text-xs text-zinc-600">Use the arrows to set the order — it saves as you go.</p>
      )}
      {failed && (
        <p className="mt-2 text-xs text-red-400">
          {failed instanceof Error ? failed.message : "Couldn't save that order"}
        </p>
      )}
    </section>
  );
}

/** One linked game: opens your copy when you own it, the catalog page if not. */
function LinkRow({
  gameId,
  link,
  number,
  onMove,
  isFirst,
  isLast,
}: {
  gameId: string;
  link: GameLink;
  number: number | null;
  onMove?: (delta: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const queryClient = useQueryClient();
  const prefs = usePreferences();
  const categories = useCategories();
  const remove = useMutation({
    mutationFn: () => api.removeGameLink(gameId, link.id),
    // both ends drop it, so every cached game's links are stale
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-links"] }),
  });

  const chip = link.game.status ? statusChip(link.game.status, prefs, categories) : null;

  return (
    <li className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2 pr-2.5">
      {number !== null && (
        <span className="w-6 flex-none text-right text-sm font-bold text-indigo-300 tabular-nums">
          {number}
        </span>
      )}
      <OpenGame
        game={link.game}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-80"
      >
        <div className="h-14 w-10 flex-none overflow-hidden rounded bg-zinc-800">
          {link.game.coverSrc && (
            <img src={link.game.coverSrc} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-zinc-100" title={link.game.title}>
            {link.game.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{link.game.releaseDate ? link.game.releaseDate.slice(0, 4) : "Release date unknown"}</span>
            {chip ? (
              <span className={`${chip.className} rounded-full px-2 py-0.5`} style={chip.style}>
                {statusLabel(link.game.status!, categories)}
              </span>
            ) : (
              <span className="rounded-full border border-dashed border-zinc-700 px-2 py-0.5">
                Not in your library
              </span>
            )}
          </div>
        </div>
      </OpenGame>

      {onMove && (
        <div className="flex flex-none flex-col gap-1">
          <button
            onClick={() => onMove(-1)}
            disabled={isFirst}
            aria-label={`Move ${link.game.title} up`}
            className="rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={isLast}
            aria-label={`Move ${link.game.title} down`}
            className="rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      )}

      <button
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
        title="Unlink"
        aria-label={`Unlink ${link.game.title}`}
        className="flex-none rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-50"
      >
        ✕
      </button>
    </li>
  );
}

/**
 * A game's links at a glance, under its title: one button, and the list only
 * when you ask for it. Hidden when there's nothing linked — the Linked tab is
 * where you'd go to add the first one.
 */
export function LinkedGamesMenu({ gameId, onManage }: { gameId: string; onManage: () => void }) {
  const links = useGameLinks(gameId);
  const total = linkCount(links.data);
  if (!links.data || total === 0) return null;
  const filled = links.data.sections.filter((section) => section.links.length > 0);

  return (
    <div className="mt-3">
      <Dropdown
        label={
          <>
            <span aria-hidden className="mr-1.5">
              🔗
            </span>
            {total} linked {total === 1 ? "game" : "games"}
          </>
        }
        widthClassName="w-96"
        buttonClassName="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      >
        {(close) => (
          <>
            <div className="max-h-96 overflow-y-auto">
              {filled.map((section) => (
                <div key={section.role}>
                  <DropdownLabel>{GAME_LINK_ROLE_META[section.role].section}</DropdownLabel>
                  {section.links.map((link) => (
                    <OpenGame
                      key={link.id}
                      game={link.game}
                      role="menuitem"
                      onClick={close}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-zinc-800 focus-visible:bg-zinc-800"
                    >
                      <div className="h-10 w-7 flex-none overflow-hidden rounded bg-zinc-800">
                        {link.game.coverSrc && (
                          <img
                            src={link.game.coverSrc}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm text-zinc-200">
                          {link.game.title}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {[
                            link.game.releaseDate?.slice(0, 4),
                            link.game.userGameId ? null : "Not in your library",
                          ]
                            .filter(Boolean)
                            .join(" · ") || " "}
                        </span>
                      </span>
                    </OpenGame>
                  ))}
                </div>
              ))}
            </div>
            <div className="mx-2 my-1.5 border-t border-zinc-800" />
            <DropdownItem
              onSelect={() => {
                close();
                onManage();
              }}
            >
              Manage links →
            </DropdownItem>
          </>
        )}
      </Dropdown>
    </div>
  );
}

/** Your copy of a game when you own it; the catalog page when you don't. */
function OpenGame({
  game,
  className,
  role,
  onClick,
  children,
}: {
  game: LinkedGame;
  className: string;
  role?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return game.userGameId ? (
    <Link
      to="/game/$id"
      params={{ id: game.userGameId }}
      role={role}
      onClick={onClick}
      className={className}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/catalog/$gameId"
      params={{ gameId: game.id }}
      role={role}
      onClick={onClick}
      className={className}
    >
      {children}
    </Link>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 px-1 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      {children}
    </p>
  );
}
