import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROGRESS_BASES,
  PROGRESS_BASIS_LABELS,
  type LibraryEntry,
  type MissionSuggestion,
  type ProgressBasis,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { formatHours } from "../lib/format.js";
import { AchievementsPanel } from "./AchievementsPanel.js";
import { ChecklistPanel } from "./ChecklistPanel.js";

/**
 * The "Progress" tab: how far through the game you are and how much play
 * time is left, plus the achievement grid and completionist checklists that
 * used to sit at the bottom of the overview.
 */
export function ProgressPanel({ entry }: { entry: LibraryEntry }) {
  const queryClient = useQueryClient();
  const entryId = entry.id;
  const gameId = entry.game.id;

  const progress = useQuery({
    queryKey: ["progress", entryId],
    queryFn: () => api.getEntryProgress(entryId),
  });

  const setBasis = useMutation({
    mutationFn: (progressBasis: ProgressBasis) => api.updateEntry(entryId, { progressBasis }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["progress", entryId] });
      queryClient.invalidateQueries({ queryKey: ["entry", entryId] });
    },
  });

  const p = progress.data;
  const hasMissions = !!p && p.total > 0;

  return (
    <div className="max-w-2xl">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-300">Time remaining</p>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            based on
            <select
              value={entry.progressBasis}
              onChange={(ev) => setBasis.mutate(ev.target.value as ProgressBasis)}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            >
              {PROGRESS_BASES.map((b) => (
                <option key={b} value={b}>
                  {PROGRESS_BASIS_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!hasMissions ? (
          <p className="mt-2 text-sm text-zinc-500">
            Add the game's missions or chapters below and ticking them off will estimate how
            much play time you have left.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-6">
              <Stat
                label="Estimated remaining"
                value={formatHours(p.remainingSeconds) ?? "—"}
                accent
              />
              <Stat label="Full length" value={formatHours(p.totalSeconds) ?? "—"} />
              <Stat
                label="Per mission"
                value={p.perItemSeconds ? (formatHours(p.perItemSeconds) ?? "—") : "—"}
              />
              <Stat label="Missions done" value={`${p.done}/${p.total}`} />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-[width]"
                style={{ width: `${p.percent}%` }}
              />
            </div>
            {!p.totalSeconds && (
              <p className="mt-2 text-xs text-amber-400/80">
                No {PROGRESS_BASIS_LABELS[entry.progressBasis].toLowerCase()} time is known for
                this game, so only mission counts are shown.
              </p>
            )}
          </>
        )}
      </div>

      <MissionSection
        gameId={gameId}
        entryId={entryId}
        checklistId={p?.checklistId ?? null}
        checklistTitle={p?.checklistTitle ?? null}
      />

      <AchievementsPanel entryId={entryId} />
      <ChecklistPanel gameId={gameId} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-600">{label}</p>
      <p className={`text-lg font-semibold ${accent ? "text-indigo-300" : "text-zinc-200"}`}>
        {value}
      </p>
    </div>
  );
}

// ---- mission list ----

function MissionSection({
  gameId,
  entryId,
  checklistId,
  checklistTitle,
}: {
  gameId: string;
  entryId: string;
  checklistId: string | null;
  checklistTitle: string | null;
}) {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<MissionSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["progress", entryId] });
    queryClient.invalidateQueries({ queryKey: ["checklists", gameId] });
    if (checklistId) queryClient.invalidateQueries({ queryKey: ["checklist", checklistId] });
  };

  const suggest = useMutation({
    mutationFn: (url?: string) => api.suggestMissions(gameId, url),
    onSuccess: (s) => {
      setError(null);
      setReview(s);
    },
    onError: (err: Error) => setError(err.message),
  });

  const detail = useQuery({
    queryKey: ["checklist", checklistId],
    queryFn: () => api.getChecklist(checklistId!),
    enabled: !!checklistId,
  });

  const check = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      api.checkChecklistItem(itemId, completed),
    onSuccess: invalidate,
  });

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-300">
          {checklistTitle ?? "Missions & chapters"}
        </p>
        {!checklistId && (
          <div className="flex gap-2">
            <button
              onClick={() => suggest.mutate(undefined)}
              disabled={suggest.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-60"
            >
              {suggest.isPending ? "Searching Fandom…" : "Find missions on a wiki"}
            </button>
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Add manually
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {error}
        </p>
      )}

      {manualOpen && !checklistId && (
        <ManualMissions
          gameId={gameId}
          pending={suggest.isPending}
          onUseUrl={(url) => suggest.mutate(url)}
          onSaved={() => {
            setManualOpen(false);
            invalidate();
          }}
        />
      )}

      {review && (
        <MissionReview
          gameId={gameId}
          suggestion={review}
          onCancel={() => setReview(null)}
          onRetry={(url) => suggest.mutate(url)}
          onSaved={() => {
            setReview(null);
            invalidate();
          }}
        />
      )}

      {checklistId && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
          {(detail.data?.items ?? []).map((item, i) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={!!item.completedAt}
                onChange={() => check.mutate({ itemId: item.id, completed: !item.completedAt })}
              />
              <span className="w-6 shrink-0 text-right text-xs text-zinc-600">{i + 1}.</span>
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  item.completedAt ? "text-zinc-600 line-through" : "text-zinc-300"
                }`}
              >
                {item.text}
              </span>
            </label>
          ))}
          {detail.data?.sourceUrl && (
            <p className="mt-2 border-t border-zinc-800/60 pt-2 text-xs text-zinc-600">
              List from{" "}
              <a
                href={detail.data.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-zinc-500 underline hover:text-zinc-300"
              >
                {new URL(detail.data.sourceUrl).host}
              </a>{" "}
              · CC-BY-SA
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Review step for a scraped list. Wiki parsing picks up stray rows, so
 * nothing is saved until the user has pruned it.
 */
function MissionReview({
  gameId,
  suggestion,
  onCancel,
  onRetry,
  onSaved,
}: {
  gameId: string;
  suggestion: MissionSuggestion;
  onCancel: () => void;
  onRetry: (url: string) => void;
  onSaved: () => void;
}) {
  const [missions, setMissions] = useState<string[]>(suggestion.missions);
  const [title, setTitle] = useState(suggestion.sectionTitle || "Missions");

  const save = useMutation({
    mutationFn: () =>
      api.importMissions(gameId, { title, missions, sourceUrl: suggestion.sourceUrl }),
    onSuccess: onSaved,
  });

  return (
    <div className="mb-3 rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-indigo-200">
          Found {missions.length} entries — check before saving
        </p>
        <a
          href={suggestion.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-indigo-400 underline hover:text-indigo-300"
        >
          {suggestion.pageTitle} on {suggestion.wikiName}
        </a>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Scraped from a wiki, so it may include rows that aren't missions. Remove anything that
        doesn't belong — the count drives the time estimate.
      </p>

      <input
        value={title}
        onChange={(ev) => setTitle(ev.target.value)}
        className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        placeholder="List name"
      />

      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1">
        {missions.map((m, i) => (
          <div key={`${m}-${i}`} className="group flex items-center gap-2 py-0.5">
            <span className="w-6 shrink-0 text-right text-xs text-zinc-600">{i + 1}.</span>
            <input
              value={m}
              onChange={(ev) =>
                setMissions(missions.map((x, xi) => (xi === i ? ev.target.value : x)))
              }
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-300 outline-none hover:border-zinc-700 focus:border-indigo-500"
            />
            <button
              onClick={() => setMissions(missions.filter((_, xi) => xi !== i))}
              className="shrink-0 px-1 text-xs text-zinc-600 hover:text-red-400"
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        {missions.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-zinc-600">
            Nothing left — try another page or cancel.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || missions.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : `Save ${missions.length} missions`}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
        {suggestion.alternatives.length > 0 && (
          <span className="text-xs text-zinc-500">
            Wrong page? Try{" "}
            {suggestion.alternatives.slice(0, 3).map((alt, i) => (
              <span key={alt.url}>
                {i > 0 && ", "}
                <button
                  onClick={() => onRetry(alt.url)}
                  className="text-indigo-400 underline hover:text-indigo-300"
                >
                  {alt.pageTitle}
                </button>
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Fallbacks for when the automatic search picks the wrong page or nothing at
 * all — which it does often enough that these are not edge cases: point it at
 * a specific wiki page, paste a list, or just say how many missions there are.
 */
function ManualMissions({
  gameId,
  pending,
  onUseUrl,
  onSaved,
}: {
  gameId: string;
  pending: boolean;
  onUseUrl: (url: string) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [count, setCount] = useState("");
  const [url, setUrl] = useState("");

  const save = useMutation({
    mutationFn: (missions: string[]) =>
      api.importMissions(gameId, { title: "Missions", missions, sourceUrl: null }),
    onSuccess: onSaved,
  });

  const pasted = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter(Boolean);

  const n = Number(count);
  const numbered =
    Number.isInteger(n) && n > 0 && n <= 500
      ? Array.from({ length: n }, (_, i) => `Mission ${i + 1}`)
      : [];

  return (
    <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="mb-1 text-xs text-zinc-500">
        Point it at a specific Fandom page — more reliable than the automatic search.
      </p>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (url.trim()) onUseUrl(url.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={url}
          onChange={(ev) => setUrl(ev.target.value)}
          placeholder="https://gta.fandom.com/wiki/Missions_in_GTA_V"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!url.trim() || pending}
          className="shrink-0 rounded-lg border border-indigo-500/50 px-3 py-1.5 text-sm font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
        >
          {pending ? "Reading…" : "Read page"}
        </button>
      </form>

      <p className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        Or paste a mission list (one per line), or just enter how many there are.
      </p>
      <textarea
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        rows={4}
        placeholder={"Mission 1: Phantom Limbs\nMission 2: Diamond Dogs\n…"}
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => save.mutate(pasted)}
          disabled={pasted.length === 0 || save.isPending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
        >
          Save {pasted.length || ""} pasted
        </button>
        <span className="text-xs text-zinc-600">or</span>
        <input
          value={count}
          onChange={(ev) => setCount(ev.target.value.replace(/\D/g, ""))}
          placeholder="38"
          className="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={() => save.mutate(numbered)}
          disabled={numbered.length === 0 || save.isPending}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Create numbered missions
        </button>
      </div>
    </div>
  );
}
