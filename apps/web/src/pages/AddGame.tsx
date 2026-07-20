import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SearchResult } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

export function AddGamePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());

  // debounce typing → query
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const search = useQuery({
    queryKey: ["game-search", query],
    queryFn: () => api.searchGames(query),
    enabled: query.length >= 2,
  });

  const add = useMutation({
    mutationFn: (result: SearchResult) =>
      api.addToLibrary(
        result.igdbId
          ? { igdbId: result.igdbId }
          : result.gameId
            ? { gameId: result.gameId }
            : { title: result.title },
      ),
    onSuccess: (data, result) => {
      setAddedTitles((prev) => new Set(prev).add(result.title));
      queryClient.invalidateQueries({ queryKey: ["library"] });
      // straight to the new entry so status/platforms can be set right away
      navigate({ to: "/game/$id", params: { id: data.id } });
    },
  });

  const addManual = useMutation({
    mutationFn: (title: string) => api.addToLibrary({ title }),
    onSuccess: (data, title) => {
      setAddedTitles((prev) => new Set(prev).add(title));
      queryClient.invalidateQueries({ queryKey: ["library"] });
      navigate({ to: "/game/$id", params: { id: data.id } });
    },
  });

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-bold">Add a game</h1>
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search for a game…"
        className="mb-6 w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-lg outline-none focus:border-indigo-500"
      />

      {search.data && !search.data.igdb && (
        <p className="mb-4 rounded-lg border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
          IGDB isn't configured yet, so search only covers games already in the local catalog.
          An admin can add free IGDB credentials under Settings — or add this game manually below.
        </p>
      )}

      {search.isLoading && <p className="text-zinc-500">Searching…</p>}
      {search.isError && <p className="text-red-400">Search failed: {String(search.error)}</p>}

      <div className="grid gap-3">
        {search.data?.results.map((r) => {
          const added = r.inLibrary || addedTitles.has(r.title);
          return (
            <div
              key={`${r.igdbId ?? r.gameId}`}
              className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="h-20 w-14 flex-none overflow-hidden rounded bg-zinc-800">
                {r.coverSrc && (
                  <img src={r.coverSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {r.title}{" "}
                  {r.releaseYear && <span className="font-normal text-zinc-500">({r.releaseYear})</span>}
                </p>
                <p className="truncate text-xs text-zinc-500">{r.platforms.join(" · ")}</p>
              </div>
              <button
                disabled={added || add.isPending}
                onClick={() => add.mutate(r)}
                className={`flex-none rounded-lg px-4 py-2 text-sm font-semibold ${
                  added
                    ? "cursor-default border border-emerald-800 bg-emerald-950 text-emerald-300"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
              >
                {added ? "✓ In library" : "Add"}
              </button>
            </div>
          );
        })}
      </div>

      {query.length >= 2 && search.data && (
        <div className="mt-6 border-t border-zinc-800 pt-4">
          <button
            disabled={addManual.isPending || addedTitles.has(query)}
            onClick={() => addManual.mutate(query)}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {addedTitles.has(query) ? "✓ Added" : `Add "${query}" manually (no metadata)`}
          </button>
        </div>
      )}
    </Shell>
  );
}
