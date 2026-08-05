import { FEEDBACK_STATUS_LABELS, type FeedbackStatus } from "@gm/shared";

/**
 * Where a piece of feedback has got to. Shared by the sender's own list and
 * the admin queue on purpose — "Planned" has to look like the same thing on
 * both sides, or the status stops meaning anything.
 */
const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: "border-zinc-700 text-zinc-400",
  planned: "border-sky-700 bg-sky-950 text-sky-300",
  in_progress: "border-indigo-600 bg-indigo-950 text-indigo-300",
  done: "border-emerald-700 bg-emerald-950 text-emerald-300",
  // deliberately the quietest of the five: a declined idea shouldn't shout
  declined: "border-zinc-700 bg-zinc-900 text-zinc-500",
};

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status]}`}
    >
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}
