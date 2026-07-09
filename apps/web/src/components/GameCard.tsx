import { Link } from "@tanstack/react-router";
import type { LibraryEntry } from "@gm/shared";
import { STATUS_META, formatHours, statusChip } from "../lib/format.js";
import { usePreferences } from "../lib/prefs.js";
import { StarRating } from "./StarRating.js";

export function GameCard({ entry }: { entry: LibraryEntry }) {
  const prefs = usePreferences();
  const chip = statusChip(entry.status, prefs);
  const ttb = formatHours(entry.game.ttbMain);
  const showTime = prefs?.showTimeBadge ?? true;
  const showPlatforms = prefs?.showPlatformBadge ?? true;

  return (
    <Link
      to="/game/$id"
      params={{ id: entry.id }}
      className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600"
    >
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
        <span
          className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-xs font-medium ${chip.className}`}
          style={chip.style}
        >
          {STATUS_META[entry.status].label}
        </span>
        {showTime && ttb && entry.ttbEnabled && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-zinc-200">
            {ttb}
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
    </Link>
  );
}
