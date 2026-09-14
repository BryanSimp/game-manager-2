import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GAME_LINK_KINDS,
  GAME_LINK_LABELS,
  type GameLink,
  type GameLinkKind,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { statusChip, statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";

/**
 * What a game is attached to, and what's attached to it.
 *
 * A Steam import files DLC as its own library entry, because that's what Steam
 * sells it as — so "Blood and Wine" sits in the grid next to "The Witcher 3"
 * with no hint that one is part of the other. This is where you say so.
 *
 * The sections are grown, not configured: with no links the panel is a single
 * button, and each heading appears the first time something is filed under it.
 * A game with no DLC shouldn't be showing you an empty "DLC & add-ons" shelf.
 *
 * The links are per-user, so this is a statement about *your* library rather
 * than an edit to the shared catalog — one person deciding a remaster is a
 * remake can't rearrange anyone else's shelves.
 */
export function RelatedGames({ gameId, title }: { gameId: string; title: string }) {
  const [adding, setAdding] = useState<null | { kind: GameLinkKind; direction: Direction }>(null);
  const links = useQuery({
    queryKey: ["game-links", gameId],
    queryFn: () => api.getGameLinks(gameId),
  });

  const children = links.data?.children ?? [];
  const parents = links.data?.parents ?? [];
  const hasAny = children.length > 0 || parents.length > 0;

  return (
    <div className="mt-8 border-t border-zinc-800 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          Related games
        </h2>
        <button
          onClick={() => setAdding({ kind: "dlc", direction: "child" })}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          ＋ Link a game
        </button>
      </div>

      {!hasAny && !adding && (
        <p className="mt-2 max-w-2xl text-sm text-zinc-500">
          Attach this game's DLC, or the remaster or remake it's related to. Useful when a
          storefront sells an add-on as its own entry — link it here and each one says what it
          belongs to.
        </p>
      )}

      {adding && (
        <LinkForm
          gameId={gameId}
          title={title}
          initial={adding}
          onClose={() => setAdding(null)}
        />
      )}

      {parents.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Part of</SectionLabel>
          <div className="mt-2 space-y-2">
            {parents.map((link) => (
              <LinkRow key={link.id} gameId={gameId} link={link} side="parent" />
            ))}
          </div>
        </div>
      )}

      {GAME_LINK_KINDS.map((kind) => {
        const rows = children.filter((l) => l.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="mt-4">
            <SectionLabel>{GAME_LINK_LABELS[kind].section}</SectionLabel>
            <div className="mt-2 space-y-2">
              {rows.map((link) => (
                <LinkRow key={link.id} gameId={gameId} link={link} side="child" />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold tracking-wide text-zinc-500">{children}</p>;
}

type Direction = "child" | "parent";

/** The two halves of every kind, as a sentence you pick rather than a form. */
const RELATIONS: Array<{ kind: GameLinkKind; direction: Direction; label: (t: string) => string }> =
  [
    { kind: "dlc", direction: "child", label: () => "is DLC for this game" },
    { kind: "dlc", direction: "parent", label: (t) => `${t} is DLC for it` },
    { kind: "remaster", direction: "child", label: () => "is a remaster of this game" },
    { kind: "remaster", direction: "parent", label: (t) => `${t} is a remaster of it` },
    { kind: "remake", direction: "child", label: () => "is a remake of this game" },
    { kind: "remake", direction: "parent", label: (t) => `${t} is a remake of it` },
  ];

/**
 * Pick a game, then say how it relates.
 *
 * The relation is phrased as a sentence about the game you're looking at
 * ("… is DLC for this game") rather than a kind plus a direction toggle,
 * because "DLC / parent" is a data model and nobody reads it twice the same
 * way. Searching is library-first and IGDB underneath — the same shape the
 * collection picker uses, and for the same reason: the thing you're linking is
 * usually already in your library, but noting an add-on you haven't bought is
 * worth allowing.
 */
function LinkForm({
  gameId,
  title,
  initial,
  onClose,
}: {
  gameId: string;
  title: string;
  initial: { kind: GameLinkKind; direction: Direction };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState(initial);
  const [picked, setPicked] = useState<{
    label: string;
    relatedGameId?: string;
    igdbId?: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const igdb = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: query.length >= 2,
  });

  const add = useMutation({
    mutationFn: () =>
      api.addGameLink(gameId, {
        kind: relation.kind,
        direction: relation.direction,
        ...(picked?.relatedGameId
          ? { relatedGameId: picked.relatedGameId }
          : { igdbId: picked!.igdbId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["game-links"] });
      onClose();
    },
  });

  const needle = query.toLowerCase();
  const mine = useMemo(
    () =>
      (library.data ?? [])
        // linking a game to itself is refused by the API; don't offer it
        .filter((e) => e.game.id !== gameId)
        .filter((e) => !needle || e.game.title.toLowerCase().includes(needle))
        .slice(0, 6),
    [library.data, gameId, needle],
  );
  const mineTitles = new Set(mine.map((e) => e.game.title.toLowerCase()));
  const external = (igdb.data?.results ?? [])
    .filter((r) => !mineTitles.has(r.title.toLowerCase()))
    .filter((r) => r.gameId !== gameId)
    .slice(0, 6);

  return (
    <div className="mt-3 max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      {picked ? (
        <>
          <p className="text-sm text-zinc-300">
            <span className="font-semibold text-zinc-100">{picked.label}</span>…
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {RELATIONS.map((r) => {
              const active = r.kind === relation.kind && r.direction === relation.direction;
              return (
                <button
                  key={`${r.kind}-${r.direction}`}
                  onClick={() => setRelation({ kind: r.kind, direction: r.direction })}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {r.label(title)}
                </button>
              );
            })}
          </div>
          {add.isError && (
            <p className="mt-2 text-xs text-red-400">
              {add.error instanceof Error ? add.error.message : "Couldn't link that game"}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => add.mutate()}
              disabled={add.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {add.isPending ? "Linking…" : "Link it"}
            </button>
            <button
              onClick={() => setPicked(null)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Pick a different game
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search your library or IGDB…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto">
            {mine.length > 0 && <GroupLabel>In your library</GroupLabel>}
            {mine.map((e) => (
              <PickRow
                key={e.game.id}
                title={e.game.title}
                coverSrc={e.game.coverSrc}
                onPick={() => setPicked({ label: e.game.title, relatedGameId: e.game.id })}
              />
            ))}

            {query.length >= 2 && (
              <>
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
                {external.map((r) => (
                  <PickRow
                    key={`${r.igdbId ?? r.gameId ?? r.title}`}
                    title={r.title}
                    year={r.releaseYear}
                    coverSrc={r.coverSrc}
                    onPick={() =>
                      setPicked(
                        r.gameId
                          ? { label: r.title, relatedGameId: r.gameId }
                          : { label: r.title, igdbId: r.igdbId! },
                      )
                    }
                  />
                ))}
              </>
            )}

            {query.length < 2 && mine.length === 0 && (
              <p className="px-1 py-2 text-xs text-zinc-500">
                Type to search. Games you don't own can be linked too.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One linked game. Opens your copy when you own it, the catalog page if not. */
function LinkRow({
  gameId,
  link,
  side,
}: {
  gameId: string;
  link: GameLink;
  side: "child" | "parent";
}) {
  const queryClient = useQueryClient();
  const prefs = usePreferences();
  const categories = useCategories();
  const remove = useMutation({
    mutationFn: () => api.removeGameLink(gameId, link.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-links"] }),
  });

  const chip = link.game.status ? statusChip(link.game.status, prefs, categories) : null;
  const body = (
    <>
      <div className="h-14 w-10 flex-none overflow-hidden rounded bg-zinc-800">
        {link.game.coverSrc && (
          <img src={link.game.coverSrc} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{link.game.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {/* on a parent row the label reads from this game's side: the row
              is the base, and the game you're on is its DLC */}
          {side === "parent" && <span>{GAME_LINK_LABELS[link.kind].back} this</span>}
          {link.game.releaseDate && <span>{link.game.releaseDate.slice(0, 4)}</span>}
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
    </>
  );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-2 pr-3">
      {link.game.userGameId ? (
        <Link
          to="/game/$id"
          params={{ id: link.game.userGameId }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-80"
        >
          {body}
        </Link>
      ) : (
        <Link
          to="/catalog/$gameId"
          params={{ gameId: link.game.id }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-80"
        >
          {body}
        </Link>
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
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 px-1 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      {children}
    </p>
  );
}

function PickRow({
  title,
  year,
  coverSrc,
  onPick,
}: {
  title: string;
  year?: number | null;
  coverSrc: string | null;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-zinc-800"
    >
      <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
        {coverSrc && <img src={coverSrc} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
        {title}
        {year ? <span className="text-zinc-500"> ({year})</span> : null}
      </span>
      <span className="flex-none text-xs font-semibold text-indigo-400">Choose</span>
    </button>
  );
}
