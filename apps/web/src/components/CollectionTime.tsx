import type { CollectionTime } from "@gm/shared";
import { formatHours } from "../lib/format.js";

/**
 * How long a collection takes, and how much of it is left.
 *
 * Two figures rather than one, because they answer different questions. The
 * total is a fact about the list — "this marathon is 214 hours" — and doesn't
 * move as you play. Remaining is about you: finished games drop out of it
 * entirely, and a game with a part-ticked mission list is charged only for
 * what's left of it, the same estimate its library card shows.
 *
 * Games with no known length and games marked endless are named rather than
 * folded in at zero. A total that silently omitted a third of the list would
 * be worse than one that admits what it doesn't know.
 */

function playedPercent(time: CollectionTime): number {
  if (time.totalSeconds <= 0) return 0;
  const played = time.totalSeconds - time.remainingSeconds;
  return Math.max(0, Math.min(100, (played / time.totalSeconds) * 100));
}

/** The gaps in a total, spelled out — nothing when there aren't any. */
function caveats(time: CollectionTime): string | null {
  const parts: string[] = [];
  if (time.unknown > 0) {
    parts.push(`${time.unknown} ${time.unknown === 1 ? "game has" : "games have"} no known length`);
  }
  if (time.endless > 0) {
    parts.push(`${time.endless} endless ${time.endless === 1 ? "game" : "games"} excluded`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Full panel for a collection's own page. */
export function CollectionTimePanel({ time }: { time: CollectionTime }) {
  const total = formatHours(time.totalSeconds);
  const remaining = formatHours(time.remainingSeconds);
  const note = caveats(time);

  // Nothing known about any of the games: say so plainly rather than
  // rendering "0h to beat", which reads as "this takes no time".
  if (time.counted === 0) {
    return (
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
        ⏱ No play times known for this collection yet.
        {note && <span className="text-zinc-600"> {note}.</span>}
      </div>
    );
  }

  const done = time.remainingSeconds <= 0;

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm text-zinc-400">
          <span className="font-semibold text-zinc-100">{total}</span> to beat in full
        </span>
        <span className="text-sm text-zinc-400">
          {done ? (
            <span className="font-semibold text-emerald-400">Nothing left — all beaten</span>
          ) : (
            <>
              <span className="font-semibold text-indigo-300">{remaining}</span> left
            </>
          )}
        </span>
        {time.finished > 0 && (
          <span className="text-xs text-emerald-500">{time.finished} finished</span>
        )}
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${playedPercent(time)}%` }}
        />
      </div>

      {note && <p className="mt-2 text-xs text-zinc-600">{note}.</p>}
    </div>
  );
}

/** One-line version for a collection card. */
export function CollectionTimeLine({ time }: { time: CollectionTime }) {
  if (time.counted === 0) return null;
  const total = formatHours(time.totalSeconds);
  const remaining = formatHours(time.remainingSeconds);
  return (
    <span className="text-zinc-400" title="Total time to beat · what you have left">
      ⏱ {total}
      {time.remainingSeconds > 0 && time.remainingSeconds < time.totalSeconds && (
        <span className="text-indigo-300"> · {remaining} left</span>
      )}
      {time.remainingSeconds <= 0 && <span className="text-emerald-400"> · beaten</span>}
    </span>
  );
}
