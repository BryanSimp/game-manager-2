import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { GameCard } from "../components/GameCard.js";
import { STATUS_META } from "../lib/format.js";

export function LibraryPage() {
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [search, setSearch] = useState("");
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });

  const entries = (library.data ?? []).filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search && !e.game.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = new Map<string, number>();
  for (const e of library.data ?? []) {
    counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  }

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">
          Library{" "}
          <span className="text-sm font-normal text-zinc-500">
            {library.data?.length ?? 0} games
          </span>
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by title…"
          className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip
          label={`All (${library.data?.length ?? 0})`}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        {GAME_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={`${STATUS_META[s].label} (${counts.get(s) ?? 0})`}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            dot={STATUS_META[s].dot}
          />
        ))}
      </div>

      {library.isLoading && <p className="text-zinc-500">Loading library…</p>}

      {library.data?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">Your library is empty</p>
          <p className="mb-6 text-sm text-zinc-400">
            Add your first game by searching, or paste your whole list at once.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/add"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
            >
              Add a game
            </Link>
            <Link
              to="/import"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-800"
            >
              Import a list
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {entries.map((entry) => (
          <GameCard key={entry.id} entry={entry} />
        ))}
      </div>

      {library.data && library.data.length > 0 && entries.length === 0 && (
        <p className="text-zinc-500">No games match this filter.</p>
      )}
    </Shell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  dot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
        active
          ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
    >
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}
