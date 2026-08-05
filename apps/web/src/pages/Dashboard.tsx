import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GAME_STATUSES } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { STATUS_META, formatHours, statusChip } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";
import { StarRating } from "../components/StarRating.js";

export function DashboardPage() {
  const prefs = usePreferences();
  const categories = useCategories();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard() });
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const [rerollNonce, setRerollNonce] = useState(0);
  // what the dice rolls from — backlog is the question's usual meaning
  const [pickStatus, setPickStatus] = useState("backlog");
  const [pickPlatform, setPickPlatform] = useState("all");

  /**
   * Platforms to offer the roll, rolled up the way the library filter does it:
   * picking PC includes anything filed under one of its storefronts.
   */
  const platformOptions = useMemo(() => {
    const parents = new Map<string, { label: string; children: Map<string, string> }>();
    for (const e of library.data ?? []) {
      for (const p of e.platforms) {
        if (p.parentPlatformId && p.parentName) {
          const parent = parents.get(p.parentPlatformId) ?? {
            label: p.parentName,
            children: new Map(),
          };
          parent.children.set(p.platformId, p.name);
          parents.set(p.parentPlatformId, parent);
        } else if (!parents.has(p.platformId)) {
          parents.set(p.platformId, { label: p.abbreviation ?? p.name, children: new Map() });
        }
      }
    }
    const options: Array<[string, string]> = [];
    for (const [id, parent] of [...parents.entries()].sort((a, b) =>
      a[1].label.localeCompare(b[1].label),
    )) {
      options.push([id, parent.children.size > 0 ? `${parent.label} (all)` : parent.label]);
      for (const [childId, name] of [...parent.children.entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      )) {
        options.push([childId, `   ↳ ${name}`]);
      }
    }
    return options;
  }, [library.data]);

  const candidates = useMemo(
    () =>
      (library.data ?? []).filter((e) => {
        if (pickStatus !== "all" && e.status !== pickStatus) return false;
        if (
          pickPlatform !== "all" &&
          !e.platforms.some(
            (p) => p.platformId === pickPlatform || p.parentPlatformId === pickPlatform,
          )
        )
          return false;
        return true;
      }),
    [library.data, pickStatus, pickPlatform],
  );

  const randomPick = useMemo(() => {
    if (candidates.length === 0) return null;
    // rerollNonce re-runs the memo for a new pick
    void rerollNonce;
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }, [candidates, rerollNonce]);

  const d = dashboard.data;
  const backlogHours = formatHours(d?.backlogSeconds ?? 0);
  const maxPlatform = Math.max(1, ...(d?.platformCounts.map((p) => p.count) ?? [1]));

  // covers are w-20 with a gap-3 between them
  const finishedRow = useFitCount(80, 12);
  const finishedHidden = Math.max(0, (d?.recentlyFinished.length ?? 0) - finishedRow.count);

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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-300">What should I play next?</h2>
            <button
              onClick={() => setRerollNonce((n) => n + 1)}
              className="flex-none rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              🎲 Reroll
            </button>
          </div>

          {/* what the roll draws from */}
          <div className="mb-4 flex flex-wrap gap-2">
            <select
              value={pickStatus}
              onChange={(e) => setPickStatus(e.target.value)}
              title="Which category to roll from"
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-indigo-500"
            >
              <option value="all">Any category</option>
              {(categories ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                  {c.count > 0 ? ` (${c.count})` : ""}
                </option>
              ))}
            </select>
            {platformOptions.length > 0 && (
              <select
                value={pickPlatform}
                onChange={(e) => setPickPlatform(e.target.value)}
                title="Which console to roll from"
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-indigo-500"
              >
                <option value="all">Any console</option>
                {platformOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <span className="self-center text-xs text-zinc-600">
              {candidates.length} to choose from
            </span>
          </div>

          {randomPick ? (
            <Link to="/game/$id" params={{ id: randomPick.id }} className="group flex gap-4">
              {/* self-start or the flex row stretches the box past 3:4 and the
                  cover art gets cropped — happens as soon as the summary is
                  taller than the cover, i.e. on any narrow screen */}
              <div className="aspect-[3/4] w-32 flex-none self-start overflow-hidden rounded-lg bg-zinc-800 sm:w-36">
                {randomPick.game.coverSrc && (
                  <img
                    src={randomPick.game.coverSrc}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="font-semibold leading-snug group-hover:text-white">
                  {randomPick.game.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                  {randomPick.game.releaseDate && (
                    <span>{randomPick.game.releaseDate.slice(0, 4)}</span>
                  )}
                  {formatHours(randomPick.game.ttbMain) && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                      ≈ {formatHours(randomPick.game.ttbMain)} main story
                    </span>
                  )}
                  {formatHours(randomPick.game.ttbCompletionist) && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                      {formatHours(randomPick.game.ttbCompletionist)} to 100%
                    </span>
                  )}
                </div>
                {/* six lines lands the text about level with the cover */}
                <p className="mt-2 line-clamp-6 text-sm leading-relaxed text-zinc-400">
                  {randomPick.game.summary ?? "No description for this one yet."}
                </p>
              </div>
            </Link>
          ) : (
            <p className="text-sm text-zinc-500">
              {pickStatus === "backlog" && pickPlatform === "all"
                ? "Your backlog is empty — nice!"
                : "Nothing in your library matches that filter."}
            </p>
          )}
        </section>

        {/* recently finished */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-300">Recently finished</h2>
            {finishedHidden > 0 && (
              <Link to="/" className="text-xs text-zinc-600 hover:text-zinc-400">
                +{finishedHidden} more
              </Link>
            )}
          </div>
          {d && d.recentlyFinished.length > 0 ? (
            <div ref={finishedRow.ref} className="flex gap-3">
              {d.recentlyFinished.slice(0, finishedRow.count).map((g) => (
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

/**
 * How many fixed-width items fit across a container, measured rather than
 * guessed. The recently-finished row used to scroll sideways, which left a
 * cover sliced in half at the edge of the card — this renders only the ones
 * that fit. The container is full-width whatever it holds, so trimming the
 * list can't shrink it and start a measure loop.
 */
function useFitCount(itemWidth: number, gap: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [count, setCount] = useState(1);

  // layout, not plain effect: the first measure has to land before the paint,
  // or the row shows one cover for a frame and then snaps to five
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      setCount(Math.max(1, Math.floor((el.clientWidth + gap) / (itemWidth + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, itemWidth, gap]);

  return { ref: setEl, count };
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
