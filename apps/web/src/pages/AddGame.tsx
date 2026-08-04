import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddGameInput, OwnershipFormat, SearchResult } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { ConsoleSelect } from "../components/ConsolePicker.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";

export function AddGamePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefs = usePreferences();
  const categories = useCategories();
  // ?q= arrives when something links here to add a specific game
  const { q } = useSearch({ from: "/add" });
  const [input, setInput] = useState(q ?? "");
  const [query, setQuery] = useState(q ?? "");
  const [yearInput, setYearInput] = useState("");
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());

  // quick add: stay on the page and keep the same platform + category for
  // every game, so a run of adds is one click each
  const [quickAdd, setQuickAdd] = useState(false);
  const [quickPlatform, setQuickPlatform] = useState<string | null>(null);
  const [quickFormat, setQuickFormat] = useState<OwnershipFormat>("digital");
  const [quickStatus, setQuickStatus] = useState<string | null>(null);

  // seed quick add from the defaults once preferences land
  useEffect(() => {
    if (!prefs) return;
    setQuickPlatform((current) => current ?? prefs.defaultPlatformId);
    setQuickFormat(prefs.defaultPlatformFormat);
    setQuickStatus((current) => current ?? prefs.defaultStatus);
  }, [prefs]);

  // debounce typing → query
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const year = /^\d{4}$/.test(yearInput.trim()) ? Number(yearInput.trim()) : null;

  const search = useQuery({
    queryKey: ["game-search", query, year],
    queryFn: () => api.searchGames(query, { year }),
    enabled: query.length >= 2,
  });

  /** What quick add pins onto every add; null platform means "leave it". */
  function quickFields(): Partial<AddGameInput> {
    if (!quickAdd) return {};
    return {
      ...(quickStatus && { status: quickStatus }),
      platforms: quickPlatform ? [{ platformId: quickPlatform, format: quickFormat }] : [],
    };
  }

  function afterAdd(entryId: string, title: string) {
    setAddedTitles((prev) => new Set(prev).add(title));
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["consoles"] });
    // quick add keeps you in the search results; the normal flow drops you on
    // the game so status and platforms can be set right away
    if (!quickAdd) navigate({ to: "/game/$id", params: { id: entryId } });
  }

  const add = useMutation({
    mutationFn: (result: SearchResult) =>
      api.addToLibrary({
        ...(result.igdbId
          ? { igdbId: result.igdbId }
          : result.gameId
            ? { gameId: result.gameId }
            : { title: result.title }),
        ...quickFields(),
      }),
    onSuccess: (data, result) => afterAdd(data.id, result.title),
  });

  const addManual = useMutation({
    mutationFn: (title: string) => api.addToLibrary({ title, ...quickFields() }),
    onSuccess: (data, title) => afterAdd(data.id, title),
  });

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-bold">Add a game</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search for a game…"
          className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-lg outline-none focus:border-indigo-500 sm:max-w-xl"
        />
        <input
          value={yearInput}
          onChange={(e) => setYearInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          placeholder="Year"
          title="Only show games first released this year"
          className="w-24 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-lg outline-none focus:border-indigo-500"
        />
        {yearInput && (
          <button
            onClick={() => setYearInput("")}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Clear year
          </button>
        )}
      </div>

      <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <button
            role="switch"
            aria-checked={quickAdd}
            onClick={() => setQuickAdd(!quickAdd)}
            className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
              quickAdd ? "bg-indigo-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                quickAdd ? "translate-x-5" : ""
              }`}
            />
          </button>
          <span>
            <span className="text-sm font-semibold text-zinc-200">⚡ Quick add</span>
            <span className="ml-2 text-xs text-zinc-500">
              Add with the settings below and stay here — no trip to the game page.
            </span>
          </span>
        </label>

        {quickAdd && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-zinc-800 pt-4">
            <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              Platform
              <ConsoleSelect value={quickPlatform} onChange={setQuickPlatform} />
            </label>
            {quickPlatform && (
              <button
                onClick={() => setQuickFormat(quickFormat === "digital" ? "physical" : "digital")}
                title="Toggle physical/digital"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {quickFormat === "physical" ? "📦 Physical" : "💾 Digital"}
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              Category
              <select
                value={quickStatus ?? ""}
                onChange={(e) => setQuickStatus(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              >
                {(categories ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {addedTitles.size > 0 && (
              <span className="text-xs text-emerald-400">
                {addedTitles.size} added this session
              </span>
            )}
          </div>
        )}
      </section>

      {search.data && !search.data.igdb && (
        <p className="mb-4 rounded-lg border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
          IGDB isn't configured yet, so search only covers games already in the local catalog.
          An admin can add free IGDB credentials under Settings — or add this game manually below.
        </p>
      )}

      {search.isLoading && <p className="text-zinc-500">Searching…</p>}
      {search.isError && <p className="text-red-400">Search failed: {String(search.error)}</p>}
      {search.data?.results.length === 0 && year && (
        <p className="text-zinc-500">
          Nothing from {year} matched — try clearing the year.
        </p>
      )}

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
                {added ? "✓ In library" : quickAdd ? "⚡ Add" : "Add"}
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
