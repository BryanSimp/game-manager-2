import { Link } from "@tanstack/react-router";
import type { LibraryEntry } from "@gm/shared";
import { STATUS_META, formatHours, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";
import { StarRating } from "./StarRating.js";

export function GameCard({
  entry,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  entry: LibraryEntry;
  /** selection mode: clicking toggles instead of navigating */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const prefs = usePreferences();
  const chip = statusChip(entry.status, prefs);
  // once a game has a mission list, the badge counts down rather than showing
  // the same full length whatever your progress
  const estimating = entry.estimatedRemainingSeconds !== null;
  const ttb = formatHours(entry.estimatedRemainingSeconds ?? entry.game.ttbMain);
  const showTime = prefs?.showTimeBadge ?? true;
  const showPlatforms = prefs?.showPlatformBadge ?? true;

  const body = (
    <>
      <div className="relative aspect-[3/4] bg-zinc-800">
        {entry.game.coverSrc ? (
          <img
            src={entry.game.coverSrc}
            alt={entry.game.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-zinc-500">
            {entry.game.title}
          </div>
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${chip.className}`}
            style={chip.style}
          >
            {STATUS_META[entry.status].label}
          </span>
          {entry.completed100 && (
            <span
              title="100% completed"
              className="rounded-full border border-amber-500/60 bg-amber-950/80 px-1.5 py-0.5 text-xs"
            >
              💯
            </span>
          )}
        </span>
        {selectable && (
          <span
            className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
              selected
                ? "border-indigo-400 bg-indigo-500 text-white"
                : "border-zinc-400 bg-black/50 text-transparent"
            }`}
          >
            ✓
          </span>
        )}
        {!selectable && showTime && ttb && entry.ttbEnabled && (
          <span
            title={
              estimating
                ? `~${ttb} left · ${entry.missionsDone}/${entry.missionsTotal} missions done`
                : "How long to beat — main story"
            }
            className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs ${
              estimating ? "bg-indigo-600/80 text-white" : "bg-black/70 text-zinc-200"
            }`}
          >
            {estimating ? `~${ttb}` : ttb}
          </span>
        )}
        {entry.tags.length > 0 && (
          <span className="absolute bottom-2 left-2 flex gap-1">
            {entry.tags.slice(0, 5).map((t) => (
              <span
                key={t.id}
                title={t.name}
                className="h-2.5 w-2.5 rounded-full border border-black/40"
                style={{ backgroundColor: t.color ?? "#71717a" }}
              />
            ))}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-sm font-semibold group-hover:text-white">
          {entry.game.title}
        </p>
        <div className="mt-1 flex items-center justify-between">
          <StarRating value={entry.rating} size="sm" />
          {showPlatforms && (
            <span className="truncate pl-2 text-xs text-zinc-500">
              {entry.platforms.map((p) => p.abbreviation ?? p.name).join(" · ")}
            </span>
          )}
        </div>
      </div>
    </>
  );

  const frame = `group overflow-hidden rounded-xl border bg-zinc-900 transition ${
    selected
      ? "border-indigo-500 ring-2 ring-indigo-500/60"
      : "border-zinc-800 hover:border-zinc-600"
  }`;

  if (selectable) {
    return (
      <button type="button" onClick={onToggleSelect} className={`${frame} text-left`}>
        {body}
      </button>
    );
  }
  return (
    <Link to="/game/$id" params={{ id: entry.id }} className={frame}>
      {body}
    </Link>
  );
}
