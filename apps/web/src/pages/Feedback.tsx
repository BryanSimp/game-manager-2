import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEEDBACK_AREAS,
  FEEDBACK_AREA_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  feedbackSubmissionSchema,
  type FeedbackArea,
  type FeedbackKind,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { StatusBadge } from "../components/FeedbackStatusBadge.js";

/**
 * In-app feedback: report a bug, ask for a feature, or say what you think of
 * one that already exists.
 *
 * Separate from the marketing site's contact form, which is anonymous and
 * sends an email. This one knows who you are, so it doesn't ask, and it lands
 * in a queue the admin can filter and triage months later — which is also why
 * you get to see what happened to what you sent.
 */

const KIND_HINTS: Record<FeedbackKind, string> = {
  bug: "What you did, what happened, and what you expected instead.",
  feature_request: "What you're trying to do that the app makes hard or impossible.",
  feedback: "What works, what doesn't, and what you'd change about it.",
};

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500";

export function FeedbackPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [area, setArea] = useState<FeedbackArea>("library");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery({ queryKey: ["my-feedback"], queryFn: () => api.getMyFeedback() });

  const send = useMutation({
    mutationFn: () => api.submitFeedback({ kind, area, subject, message }),
    onSuccess: () => {
      setSubject("");
      setMessage("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["my-feedback"] });
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Something went wrong — please try again."),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // the same schema the API validates with, so a too-short message reads
    // identically on both sides
    const parsed = feedbackSubmissionSchema.safeParse({ kind, area, subject, message });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    send.mutate();
  }

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-zinc-100">Feedback</h1>
        <p className="text-sm text-zinc-500">
          Found a bug, want a feature, or got an opinion about one that's already here? This goes
          straight to the person who builds it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form onSubmit={onSubmit} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <fieldset>
            <legend className="text-sm font-semibold text-zinc-300">What's this about?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {FEEDBACK_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    kind === k
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {FEEDBACK_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{KIND_HINTS[kind]}</p>
          </fieldset>

          <label className="mt-4 block text-xs text-zinc-500">
            Which part of the app?
            <select
              value={area}
              onChange={(ev) => setArea(ev.target.value as FeedbackArea)}
              className={`mt-1 ${inputClass}`}
            >
              {FEEDBACK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {FEEDBACK_AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-xs text-zinc-500">
            Title
            <input
              value={subject}
              onChange={(ev) => setSubject(ev.target.value)}
              maxLength={140}
              placeholder="Steam import filed everything under PC"
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <label className="mt-4 block text-xs text-zinc-500">
            Details
            <textarea
              value={message}
              onChange={(ev) => setMessage(ev.target.value)}
              rows={7}
              maxLength={4000}
              placeholder="What you did, what happened, and what you expected…"
              className={`mt-1 ${inputClass}`}
            />
          </label>

          {error && (
            <p className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              {error}
            </p>
          )}
          {send.isSuccess && !error && (
            <p className="mt-3 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
              Thanks — that's logged. It'll show up below, and here's where you'll see it move.
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={send.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {send.isPending ? "Sending…" : "Send feedback"}
            </button>
            <span className="text-xs text-zinc-600">
              Sent from your account — no need to leave contact details.
            </span>
          </div>
        </form>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">What you've sent</h2>
          {mine.isLoading && <p className="text-xs text-zinc-600">Loading…</p>}
          {mine.data?.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
              Nothing yet. Anything you send shows up here with where it's got to.
            </p>
          )}
          <div className="space-y-2">
            {(mine.data ?? []).map((item) => (
              <details
                key={item.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
              >
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {item.subject}
                  </span>
                  <StatusBadge status={item.status} />
                </summary>
                <p className="mt-2 text-xs text-zinc-500">
                  {FEEDBACK_KIND_LABELS[item.kind]} · {FEEDBACK_AREA_LABELS[item.area]} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">{item.message}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
