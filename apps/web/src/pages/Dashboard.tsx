import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { STATUS_META, formatHours, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";
import { StarRating } from "../components/StarRating.js";

export function DashboardPage() {
  const prefs = usePreferences();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const [rerollNonce, setRerollNonce] = useState(0);

  const randomPick = useMemo(() => {
    const backlog = (library.data ?? []).filter((e) => e.status === "backlog");
    if (backlog.length === 0) return null;
    // rerollNonce re-runs the memo for a new pick
    void rerollNonce;
    return backlog[Math.floor(Math.random() * backlog.length)] ?? null;
  }, [library.data, rerollNonce]);

  const d = dashboard.data;
  const backlogHours = formatHours(d?.backlogSeconds ?? 0);
  const maxPlatform = Math.max(1, ...(d?.platformCounts.map((p) => p.count) ?? [1]));

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-bold">Dashboard</h1>

      {/* stat tiles */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Games in library" value={d ? String(d.total) : "…"} />
        <StatTile
          label="Backlog"
          value={d ? String(d.statusCounts.backlog ?? 0) : "…"}
          hint={backlogHours ? `≈ ${backlogHours} to clear` : undefined}
        />
        <StatTile label="Playing now" value={d ? String(d.statusCounts.playing ?? 0) : "…"} />
        <StatTile label="Finished" value={d ? String(d.statusCounts.finished ?? 0) : "…"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* status breakdown */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">By status</h2>
          {d && d.total > 0 ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full">
                {GAME_STATUSES.map((s) => {
                  const n = d.statusCounts[s] ?? 0;
                  if (n === 0) return null;
                  const custom = prefs?.statusColors?.[s];
                  return (
                    <div
                      key={s}
                      title={`${STATUS_META[s].label}: ${n}`}
                      className={custom ? "" : STATUS_META[s].dot}
                      style={{
                        width: `${(n / d.total) * 100}%`,
                        marginRight: 2,
                        ...(custom ? { backgroundColor: custom } : {}),
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {GAME_STATUSES.map((s) => {
                  const chip = statusChip(s, prefs);
                  return (
                    <span
                      key={s}
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.className}`}
                      style={chip.style}
                    >
                      {STATUS_META[s].label} · {d.statusCounts[s] ?? 0}
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Add some games to see stats.</p>
          )}
        </section>

        {/* platforms */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">By platform</h2>
          {d && d.platformCounts.length > 0 ? (
            <div className="space-y-2">
              {d.platformCounts.slice(0, 8).map((p) => (
                <div key={p.name} className="flex items-center gap-3 text-sm">
                  <span className="w-24 flex-none truncate text-zinc-400">
                    {p.abbreviation ?? p.name}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${(p.count / maxPlatform) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 flex-none text-right font-medium text-zinc-200">
                    {p.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Mark which platforms you own games on to see this chart.
            </p>
          )}
        </section>

        {/* random pick */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">What should I play next?</h2>
            <button
              onClick={() => setRerollNonce((n) => n + 1)}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              🎲 Reroll
            </button>
          </div>
          {randomPick ? (
            <Link to="/game/$id" params={{ id: randomPick.id }} className="flex items-center gap-4">
              <div className="h-24 w-18 w-[72px] flex-none overflow-hidden rounded-lg bg-zinc-800">
                {randomPick.game.coverSrc && (
                  <img
                    src={randomPick.game.coverSrc}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div>
                <p className="font-semibold hover:text-white">{randomPick.game.title}</p>
                {randomPick.game.ttbMain && (
                  <p className="mt-1 text-sm text-zinc-500">
                    ≈ {formatHours(randomPick.game.ttbMain)} main story
                  </p>
                )}
              </div>
            </Link>
          ) : (
            <p className="text-sm text-zinc-500">Your backlog is empty — nice!</p>
          )}
        </section>

        {/* recently finished */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Recently finished</h2>
          {d && d.recentlyFinished.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {d.recentlyFinished.map((g) => (
                <Link key={g.id} to="/game/$id" params={{ id: g.id }} className="w-20 flex-none">
                  <div className="aspect-[3/4] overflow-hidden rounded-lg bg-zinc-800">
                    {g.coverSrc && (
                      <img src={g.coverSrc} alt={g.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-400" title={g.title}>
                    {g.title}
                  </p>
                  {g.rating != null && <StarRating value={g.rating} size="sm" />}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Finish a game and it shows up here.</p>
          )}
        </section>
      </div>
    </Shell>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
