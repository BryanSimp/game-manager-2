import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MISSION_LIST_KINDS,
  PROGRESS_BASES,
  PROGRESS_BASIS_LABELS,
  type ChecklistDetail,
  type ChecklistItemView,
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

      {MISSION_LIST_KINDS.map((l) => (
        <MissionSection
          key={l.kind}
          gameId={gameId}
          entryId={entryId}
          kind={l.kind}
          label={l.label}
          // chapters group the story; side quests are a flat pile by nature
          supportsChapters={l.kind === "missions"}
          // the scraper hunts for main-mission sections and denylists "side",
          // so pointing it at a side-quest list would just re-import the story
          allowWikiSearch={l.kind === "missions"}
        />
      ))}

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

type MissionListKind = (typeof MISSION_LIST_KINDS)[number]["kind"];

type NumberedItem = ChecklistItemView & { displayIndex: number };

/**
 * Group missions under their chapter, preserving list order. Chapters are
 * just `checklist_items.category` — a mission with none sorts into the
 * leading unchaptered group, so a flat list still renders as a flat list.
 * Numbering stays continuous across chapters so "mission 24" means the 24th.
 */
export function groupByChapter(items: ChecklistItemView[]): Array<[string, NumberedItem[]]> {
  const groups: Array<[string, NumberedItem[]]> = [];
  const byChapter = new Map<string, NumberedItem[]>();

  items.forEach((item, i) => {
    const chapter = item.category?.trim() || "";
    let bucket = byChapter.get(chapter);
    if (!bucket) {
      bucket = [];
      byChapter.set(chapter, bucket);
      groups.push([chapter, bucket]);
    }
    bucket.push({ ...item, displayIndex: i + 1 });
  });
  return groups;
}

function MissionSection({
  gameId,
  entryId,
  kind,
  label,
  supportsChapters,
  allowWikiSearch,
}: {
  gameId: string;
  entryId: string;
  kind: MissionListKind;
  label: string;
  supportsChapters: boolean;
  allowWikiSearch: boolean;
}) {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<MissionSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggleChapter = (chapter: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(chapter)) next.add(chapter);
      return next;
    });

  // `mine` comes back oldest-first, so this picks the same list the estimate
  // uses when someone has somehow ended up with two
  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });
  const summary = lists.data?.mine.find((c) => c.kind === kind) ?? null;
  const checklistId = summary?.id ?? null;
  const checklistTitle = summary?.title ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["progress", entryId] });
    queryClient.invalidateQueries({ queryKey: ["checklists", gameId] });
    if (checklistId) queryClient.invalidateQueries({ queryKey: ["checklist", checklistId] });
    // the entry carries the estimate for the "how long to beat" card, and the
    // library list sorts on it
    queryClient.invalidateQueries({ queryKey: ["entry", entryId] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
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

  const sequential = summary?.sequential ?? false;

  const setSequential = useMutation({
    mutationFn: (next: boolean) => api.updateChecklist(checklistId!, { sequential: next }),
    onSuccess: invalidate,
  });

  /**
   * Tick an entry. On a sequential list, checking mission 15 also fills in
   * 1-14 — you can't have reached it otherwise. Unchecking only clears that
   * one entry, so you can still mark a single mission you skipped.
   */
  const check = useMutation({
    mutationFn: async ({
      itemId,
      completed,
      index,
    }: {
      itemId: string;
      completed: boolean;
      index: number;
    }) => {
      const items = detail.data?.items ?? [];
      if (sequential && completed && checklistId) {
        const through = items.slice(0, index + 1).filter((it) => !it.completedAt);
        if (through.length > 1) {
          await api.checkChecklistItems(
            checklistId,
            through.map((it) => it.id),
            true,
          );
          return;
        }
      }
      await api.checkChecklistItem(itemId, completed);
    },
    onSuccess: invalidate,
  });

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-300">
          {label}
          {checklistTitle && checklistTitle !== label && (
            <span className="ml-2 font-normal text-zinc-500">{checklistTitle}</span>
          )}
          {!supportsChapters && (
            <span className="ml-2 text-xs font-normal text-zinc-600">(not timed)</span>
          )}
        </p>
        {!checklistId ? (
          <div className="flex gap-2">
            {allowWikiSearch && (
              <button
                onClick={() => suggest.mutate(undefined)}
                disabled={suggest.isPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-60"
              >
                {suggest.isPending ? "Searching Fandom…" : "Find missions on a wiki"}
              </button>
            )}
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {allowWikiSearch ? "Add manually" : `Add ${label.toLowerCase()}`}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {supportsChapters && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400"
                title="Story missions are played in order, so ticking one fills in everything before it. Untick a single mission if you skipped it."
              >
                <input
                  type="checkbox"
                  checked={sequential}
                  onChange={(ev) => setSequential.mutate(ev.target.checked)}
                />
                Sequential
              </label>
            )}
            <button
              onClick={() => setEditing((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                editing
                  ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {editing ? "✓ Done editing" : "✎ Edit list"}
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
          kind={kind}
          label={label}
          allowWikiUrl={allowWikiSearch}
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

      {checklistId && editing && detail.data && (
        <MissionEditor
          detail={detail.data}
          supportsChapters={supportsChapters}
          onChanged={invalidate}
          onDeleted={() => {
            setEditing(false);
            invalidate();
          }}
        />
      )}

      {checklistId && !editing && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
          {groupByChapter(detail.data?.items ?? []).map(([chapter, items]) => (
            <div key={chapter || "_none"}>
              {chapter && (
                <button
                  onClick={() => toggleChapter(chapter)}
                  className="mb-0.5 mt-2 flex w-full items-center gap-2 text-left first:mt-0"
                >
                  <span className="w-3 shrink-0 text-xs text-zinc-600">
                    {collapsed.has(chapter) ? "▸" : "▾"}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-indigo-400/70">
                    {chapter}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {items.filter((i) => i.completedAt).length}/{items.length}
                  </span>
                </button>
              )}
              {(!chapter || !collapsed.has(chapter)) &&
                items.map((item) => (
                  <label
                    key={item.id}
                    className={`flex cursor-pointer items-center gap-2 py-0.5 ${
                      chapter ? "pl-5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!item.completedAt}
                      onChange={() =>
                        check.mutate({
                          itemId: item.id,
                          completed: !item.completedAt,
                          // displayIndex is 1-based and continuous across chapters
                          index: item.displayIndex - 1,
                        })
                      }
                    />
                    <span className="w-6 shrink-0 text-right text-xs text-zinc-600">
                      {item.displayIndex}.
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        item.completedAt ? "text-zinc-600 line-through" : "text-zinc-300"
                      }`}
                    >
                      {item.text}
                    </span>
                  </label>
                ))}
            </div>
          ))}
          {detail.data?.items.length === 0 && (
            <p className="py-2 text-center text-xs text-zinc-600">
              Empty — use “Edit list” to add entries, or delete the list to start over.
            </p>
          )}
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
 * Edit an existing mission list: rename it, fix or reorder entries, add ones
 * the wiki missed, drop the ones it invented, or delete the list outright.
 * Scraped lists are rarely perfect first time, so this is the repair bench.
 */
function MissionEditor({
  detail,
  supportsChapters,
  onChanged,
  onDeleted,
}: {
  detail: ChecklistDetail;
  supportsChapters: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(detail.title);
  const [newMission, setNewMission] = useState("");
  const [newChapter, setNewChapter] = useState("");

  const items = detail.items;
  // chapters exist by being named on a mission — no empty-chapter concept to
  // keep in sync. This feeds the datalist so names stay consistent.
  const chapters = [
    ...new Set(items.map((i) => i.category?.trim()).filter((c): c is string => !!c)),
  ];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["checklist", detail.id] });
    onChanged();
  };

  const rename = useMutation({
    mutationFn: (next: string) => api.updateChecklist(detail.id, { title: next }),
    onSuccess: refresh,
  });
  const addItem = useMutation({
    mutationFn: ({ text, category }: { text: string; category: string | null }) =>
      api.addChecklistItem(detail.id, { text, category }),
    onSuccess: () => {
      setNewMission("");
      refresh();
    },
  });
  const editItem = useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) =>
      api.updateChecklistItem(itemId, { text }),
    onSuccess: refresh,
  });
  /** Move a mission into a chapter, or clear it by saving an empty name. */
  const setChapter = useMutation({
    mutationFn: ({ itemId, category }: { itemId: string; category: string | null }) =>
      api.updateChecklistItem(itemId, { category }),
    onSuccess: refresh,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.deleteChecklistItem(itemId),
    onSuccess: refresh,
  });
  const removeList = useMutation({
    mutationFn: () => api.deleteChecklist(detail.id),
    onSuccess: onDeleted,
  });

  /**
   * Reorder by swapping the two items' stored positions, rather than
   * renumbering the whole list — a 70-mission list would otherwise be 70
   * requests per nudge. Imported lists always have distinct positions.
   */
  const move = useMutation({
    mutationFn: async ({ index, delta }: { index: number; delta: -1 | 1 }) => {
      const a = items[index];
      const b = items[index + delta];
      if (!a || !b || a.position === b.position) return;
      await api.updateChecklistItem(a.id, { position: b.position });
      await api.updateChecklistItem(b.id, { position: a.position });
    },
    onSuccess: refresh,
  });

  return (
    <div className="rounded-lg border border-indigo-900/60 bg-zinc-900 p-3">
      <label className="block text-xs text-zinc-500">
        List name
        <input
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== detail.title) rename.mutate(next);
            else if (!next) setTitle(detail.title);
          }}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
        />
      </label>

      {supportsChapters && (
        <p className="mt-2 text-xs text-zinc-600">
          Chapters group the story. Type a name in a mission's chapter box — a new name
          creates the chapter, and clearing it moves the mission out again.
        </p>
      )}

      <datalist id={`chapters-${detail.id}`}>
        {chapters.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="mt-3 max-h-96 overflow-y-auto">
        {items.map((item, i) => (
          <MissionRow
            key={item.id}
            index={i}
            text={item.text}
            chapter={item.category}
            showChapter={supportsChapters}
            chapterListId={`chapters-${detail.id}`}
            done={!!item.completedAt}
            canMoveUp={i > 0}
            canMoveDown={i < items.length - 1}
            onSave={(text) => editItem.mutate({ itemId: item.id, text })}
            onSaveChapter={(category) => setChapter.mutate({ itemId: item.id, category })}
            onDelete={() => removeItem.mutate(item.id)}
            onMove={(delta) => move.mutate({ index: i, delta })}
          />
        ))}
        {items.length === 0 && (
          <p className="py-3 text-center text-xs text-zinc-600">
            No missions left — add one below, or delete the list.
          </p>
        )}
      </div>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (newMission.trim()) {
            addItem.mutate({ text: newMission.trim(), category: newChapter.trim() || null });
          }
        }}
        className="mt-2 flex gap-2 border-t border-zinc-800 pt-2"
      >
        <input
          value={newMission}
          onChange={(ev) => setNewMission(ev.target.value)}
          placeholder="+ add an entry"
          className="min-w-0 flex-1 rounded-lg border border-dashed border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
        />
        {supportsChapters && (
          <input
            value={newChapter}
            onChange={(ev) => setNewChapter(ev.target.value)}
            list={`chapters-${detail.id}`}
            placeholder="chapter"
            title="Leave blank for no chapter. A new name creates the chapter."
            className="w-28 shrink-0 rounded-lg border border-dashed border-zinc-800 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-zinc-700 focus:border-indigo-500"
          />
        )}
        {newMission.trim() && (
          <button
            type="submit"
            disabled={addItem.isPending}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500"
          >
            Add
          </button>
        )}
      </form>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800/60 pt-2">
        <span className="text-xs text-zinc-600">
          {items.length} missions · edits update the time estimate
        </span>
        <button
          onClick={() => {
            if (
              confirm(
                `Delete the mission list "${detail.title}"? Your ticked-off progress goes with it.`,
              )
            ) {
              removeList.mutate();
            }
          }}
          className="text-xs text-zinc-500 hover:text-red-400"
        >
          Delete list
        </button>
      </div>
    </div>
  );
}

/** One editable row. Text commits on blur so every keystroke isn't a request. */
function MissionRow({
  index,
  text,
  chapter,
  showChapter,
  chapterListId,
  done,
  canMoveUp,
  canMoveDown,
  onSave,
  onSaveChapter,
  onDelete,
  onMove,
}: {
  index: number;
  text: string;
  chapter: string | null;
  showChapter: boolean;
  chapterListId: string;
  done: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (text: string) => void;
  onSaveChapter: (category: string | null) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [chapterDraft, setChapterDraft] = useState(chapter ?? "");
  // pick up edits made elsewhere (reorder refetches the list)
  const [lastText, setLastText] = useState(text);
  if (text !== lastText) {
    setLastText(text);
    setDraft(text);
  }
  const [lastChapter, setLastChapter] = useState(chapter);
  if (chapter !== lastChapter) {
    setLastChapter(chapter);
    setChapterDraft(chapter ?? "");
  }

  const commit = () => {
    const next = draft.trim();
    if (!next) return setDraft(text); // empty isn't a rename, it's a mistake
    if (next !== text) onSave(next);
  };

  return (
    <div className="group flex items-center gap-1 py-0.5">
      <span className="w-6 shrink-0 text-right text-xs text-zinc-600">{index + 1}.</span>
      <input
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          if (ev.key === "Escape") setDraft(text);
        }}
        title={done ? "Already ticked off" : undefined}
        className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none hover:border-zinc-700 focus:border-indigo-500 ${
          done ? "text-zinc-500" : "text-zinc-200"
        }`}
      />
      {showChapter && (
        <input
          value={chapterDraft}
          onChange={(ev) => setChapterDraft(ev.target.value)}
          onBlur={() => {
            const next = chapterDraft.trim();
            if (next !== (chapter ?? "")) onSaveChapter(next || null);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") ev.currentTarget.blur();
            if (ev.key === "Escape") setChapterDraft(chapter ?? "");
          }}
          list={chapterListId}
          placeholder="chapter"
          className="w-24 shrink-0 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-indigo-300/80 outline-none hover:border-zinc-700 placeholder:text-zinc-700 focus:border-indigo-500"
        />
      )}
      <button
        onClick={() => onMove(-1)}
        disabled={!canMoveUp}
        title="Move up"
        className="shrink-0 px-1 text-xs text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:hover:text-zinc-600"
      >
        ▲
      </button>
      <button
        onClick={() => onMove(1)}
        disabled={!canMoveDown}
        title="Move down"
        className="shrink-0 px-1 text-xs text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:hover:text-zinc-600"
      >
        ▼
      </button>
      <button
        onClick={onDelete}
        title="Delete mission"
        className="shrink-0 px-1 text-xs text-zinc-600 hover:text-red-400"
      >
        ✕
      </button>
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
  kind,
  label,
  allowWikiUrl,
  pending,
  onUseUrl,
  onSaved,
}: {
  gameId: string;
  kind: MissionListKind;
  label: string;
  allowWikiUrl: boolean;
  pending: boolean;
  onUseUrl: (url: string) => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [count, setCount] = useState("");
  const [url, setUrl] = useState("");

  const save = useMutation({
    mutationFn: (missions: string[]) =>
      api.importMissions(gameId, { title: label, missions, sourceUrl: null, kind }),
    onSuccess: onSaved,
  });

  const pasted = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter(Boolean);

  const n = Number(count);
  const slotName = kind === "missions" ? "Mission" : "Side quest";
  const numbered =
    Number.isInteger(n) && n > 0 && n <= 500
      ? Array.from({ length: n }, (_, i) => `${slotName} ${i + 1}`)
      : [];

  return (
    <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      {allowWikiUrl && (
        <>
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
        </>
      )}

      <p
        className={`text-xs text-zinc-500 ${allowWikiUrl ? "mt-3 border-t border-zinc-800 pt-3" : ""}`}
      >
        Paste a list (one per line), or just enter how many there are.
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
