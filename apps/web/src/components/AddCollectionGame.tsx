import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddCollectionGameInput, CollectionListImport } from "@gm/shared";
import { api } from "../lib/api.js";

/**
 * "Add a game to this collection" — one at a time, or a whole pasted list.
 *
 * A dropdown of every library game didn't scale and showed no cover art, and
 * a collection isn't limited to games you own — "the Zelda games in order" is
 * a reading list. So this searches your library first (instant, local) and
 * offers IGDB underneath for everything else. Adding from IGDB pulls the game
 * into the shared catalog but deliberately **not** into your library.
 *
 * The paste tab is the same list import the create form offers, pointed at a
 * collection that already exists: pasted lines land at the end, in the order
 * they were pasted, and anything already here is reported rather than
 * duplicated.
 */
export function AddCollectionGame({
  collectionId,
  excludeGameIds,
}: {
  collectionId: string;
  excludeGameIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"search" | "list">("search");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [imported, setImported] = useState<CollectionListImport | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  // click-away closes the panel
  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary(), enabled: open });
  const igdb = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: open && query.length >= 2,
  });

  const add = useMutation({
    mutationFn: (input: AddCollectionGameInput) => api.addCollectionGame(collectionId, input),
    onSuccess: () => {
      setInput("");
      setQuery("");
      queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const addList = useMutation({
    mutationFn: () => api.addCollectionGamesFromList(collectionId, text),
    onSuccess: (result) => {
      setText("");
      setImported(result);
      queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const needle = query.toLowerCase();
  const mine = useMemo(
    () =>
      (library.data ?? [])
        .filter((e) => !excludeGameIds.has(e.game.id))
        .filter((e) => !needle || e.game.title.toLowerCase().includes(needle))
        .slice(0, 8),
    [library.data, excludeGameIds, needle],
  );

  // IGDB rows for games the library search already covered would just be
  // duplicates with a worse button
  const mineTitles = new Set(mine.map((e) => e.game.title.toLowerCase()));
  const external = (igdb.data?.results ?? [])
    .filter((r) => !mineTitles.has(r.title.toLowerCase()))
    .filter((r) => !r.gameId || !excludeGameIds.has(r.gameId))
    .slice(0, 8);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
      >
        ＋ Add game
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <div className="mb-2 flex gap-1 rounded-lg border border-zinc-700 p-0.5">
            {(
              [
                { key: "search", label: "Search" },
                { key: "list", label: "📝 Paste a list" },
              ] as Array<{ key: "search" | "list"; label: string }>
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setImported(null);
                }}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  tab === t.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "list" ? (
            <div>
              <textarea
                autoFocus
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                rows={6}
                placeholder={"One game per line — up to 50.\n\nHalo: Combat Evolved\nHalo 2\nHalo 3"}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => addList.mutate()}
                disabled={!text.trim() || addList.isPending}
                className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                {addList.isPending ? "Matching titles…" : "Add them all"}
              </button>
              {addList.isError && (
                <p className="mt-2 text-xs text-red-400">
                  {addList.error instanceof Error ? addList.error.message : "Couldn't add that list"}
                </p>
              )}
              {imported && (
                <div className="mt-2 text-xs">
                  <p>
                    <span className="font-semibold text-emerald-400">{imported.added} added</span>
                    {imported.duplicates > 0 && (
                      <span className="text-zinc-500"> · {imported.duplicates} already here</span>
                    )}
                    {imported.unmatched > 0 && (
                      <span className="text-amber-400"> · {imported.unmatched} not matched</span>
                    )}
                  </p>
                  {imported.results
                    .filter((r) => r.status === "unmatched" || r.status === "failed")
                    .map((r) => (
                      <p key={r.input} className="mt-1 text-zinc-500">
                        No match: {r.input}
                      </p>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
                placeholder="Search your library or IGDB…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />

              {add.isError && (
                <p className="mt-2 text-xs text-red-400">
                  {add.error instanceof Error ? add.error.message : "Couldn't add that game"}
                </p>
              )}

              <div className="mt-2 max-h-80 overflow-y-auto">
                {mine.length > 0 && <GroupLabel>In your library</GroupLabel>}
                {mine.map((e) => (
                  <Row
                    key={e.game.id}
                    title={e.game.title}
                    coverSrc={e.game.coverSrc}
                    busy={add.isPending}
                    onAdd={() => add.mutate({ gameId: e.game.id })}
                  />
                ))}

                {query.length >= 2 && (
                  <>
                    <GroupLabel>
                      From IGDB{" "}
                      <span className="font-normal normal-case text-zinc-600">
                        · added to this collection only
                      </span>
                    </GroupLabel>
                    {igdb.isLoading && <p className="px-1 py-2 text-xs text-zinc-500">Searching…</p>}
                    {!igdb.isLoading && external.length === 0 && (
                      <p className="px-1 py-2 text-xs text-zinc-500">No other matches.</p>
                    )}
                    {external.map((r) => (
                      <Row
                        key={`${r.igdbId ?? r.gameId ?? r.title}`}
                        title={r.title}
                        year={r.releaseYear}
                        coverSrc={r.coverSrc}
                        busy={add.isPending}
                        onAdd={() =>
                          add.mutate(r.igdbId ? { igdbId: r.igdbId } : { gameId: r.gameId! })
                        }
                      />
                    ))}
                  </>
                )}

                {query.length < 2 && mine.length === 0 && (
                  <p className="px-1 py-2 text-xs text-zinc-500">
                    Type to search. Games you don't own can be added too.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </p>
  );
}

function Row({
  title,
  year,
  coverSrc,
  busy,
  onAdd,
}: {
  title: string;
  year?: number | null;
  coverSrc: string | null;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      onClick={onAdd}
      disabled={busy}
      className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-zinc-800 disabled:opacity-50"
    >
      <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
        {coverSrc && <img src={coverSrc} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
        {title}
        {year ? <span className="text-zinc-500"> ({year})</span> : null}
      </span>
      <span className="flex-none text-xs font-semibold text-indigo-400">Add</span>
    </button>
  );
}
