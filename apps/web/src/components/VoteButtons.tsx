import type { VoteCounts } from "@gm/shared";

/**
 * Thumbs up/down with the running score between them.
 *
 * Clicking the vote you already cast takes it back, the way the half-star
 * rating clears itself — there's no separate "unvote" affordance to find.
 * Hidden entirely on your own work, where a vote is noise rather than signal
 * and the API refuses it anyway.
 */
export function VoteButtons({
  votes,
  disabled,
  onVote,
}: {
  votes: VoteCounts;
  disabled?: boolean;
  onVote: (value: 1 | 0 | -1) => void;
}) {
  const cast = (value: 1 | -1) => onVote(votes.mine === value ? 0 : value);

  return (
    <div className="flex items-center gap-0.5" title="Was this list any good?">
      <button
        onClick={() => cast(1)}
        disabled={disabled}
        aria-label={votes.mine === 1 ? "Remove your upvote" : "Upvote"}
        className={`rounded px-1 text-sm leading-none transition disabled:opacity-40 ${
          votes.mine === 1 ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-300"
        }`}
      >
        ▲
      </button>
      <span
        className={`min-w-4 text-center text-xs tabular-nums ${
          votes.score > 0 ? "text-emerald-400" : votes.score < 0 ? "text-rose-400" : "text-zinc-600"
        }`}
      >
        {votes.score}
      </span>
      <button
        onClick={() => cast(-1)}
        disabled={disabled}
        aria-label={votes.mine === -1 ? "Remove your downvote" : "Downvote"}
        className={`rounded px-1 text-sm leading-none transition disabled:opacity-40 ${
          votes.mine === -1 ? "text-rose-400" : "text-zinc-600 hover:text-zinc-300"
        }`}
      >
        ▼
      </button>
    </div>
  );
}
