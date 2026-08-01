import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { STATUS_META, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";

type View = "all" | "common" | "theirs";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "common", label: "In common" },
  { key: "theirs", label: "Only theirs" },
];

/** A friend's library, with the overlap with yours called out. */
export function FriendLibraryPage() {
  const { userId } = useParams({ from: "/friends/$userId" });
  const prefs = usePreferences();
  const [view, setView] = useState<View>("all");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [search, setSearch] = useState("");

  const library = useQuery({
    queryKey: ["friend-library", userId],
    queryFn: () => api.getFriendLibrary(userId),
  });

  const entries = useMemo(() => {
    const all = library.data?.entries ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((e) => {
      if (view === "common" && !e.inCommon) return false;
      if (view === "theirs" && e.inCommon) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (needle && !e.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [library.data, view, statusFilter, search]);

  if (library.isLoading) {
    return (
      <Shell>
        <p className="text-zinc-500">Loading…</p>
      </Shell>
    );
  }
  if (library.isError) {
    return (
      <Shell>
        <p className="text-red-400">
          You can't see this library — you may no longer be friends.
        </p>
        <Link to="/friends" className="mt-3 inline-block text-sm text-indigo-400 hover:underline">
          ← Back to friends
        </Link>
      </Shell>
    );
  }

  const data = library.data!;

  return (
    <Shell>
      <Link to="/friends" className="text-sm text-indigo-400 hover:underline">
        ← Friends
      </Link>
      <h1 className="mt-1 text-2xl font-bold">{data.friend.name}'s library</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {data.total} games · <span className="text-indigo-400">{data.inCommon}</span> you both have
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
              view === v.key
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
            }`}
          >
            {v.label}
            {v.key === "common" && ` (${data.inCommon})`}
            {v.key === "theirs" && ` (${data.total - data.inCommon})`}
          </button>
        ))}
        <select
          value={statusFilter}
          onChange={(ev) => setStatusFilter(ev.target.value as GameStatus | "all")}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        >
          <option value="all">Any status</option>
          {GAME_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="Search…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
      </div>

      {entries.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">Nothing matches those filters.</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {entries.map((e) => {
            const chip = statusChip(e.status, prefs);
            return (
              <div
                key={e.gameId}
                className={`overflow-hidden rounded-xl border bg-zinc-900 ${
                  e.inCommon ? "border-indigo-700/60" : "border-zinc-800"
                }`}
              >
                <div className="relative aspect-[3/4] bg-zinc-800">
                  {e.coverSrc ? (
                    <img
                      src={e.coverSrc}
                      alt={e.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-zinc-500">
                      {e.title}
                    </div>
                  )}
                  <span
                    className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-xs font-medium ${chip.className}`}
                    style={chip.style}
                  >
                    {STATUS_META[e.status].label}
                  </span>
                  {e.inCommon && (
                    <span
                      title={
                        e.myStatus
                          ? `In your library — ${STATUS_META[e.myStatus].label}`
                          : "In your library"
                      }
                      className="absolute right-2 top-2 rounded-full bg-indigo-600/90 px-2 py-0.5 text-xs font-semibold text-white"
                    >
                      ✓ both
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-semibold">{e.title}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-amber-400">
                      {e.rating != null ? `★ ${e.rating}` : ""}
                      {e.completed100 ? " 💯" : ""}
                    </span>
                    {e.platforms.length > 0 && (
                      <span className="truncate text-xs text-zinc-500">
                        {e.platforms.join(" · ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
