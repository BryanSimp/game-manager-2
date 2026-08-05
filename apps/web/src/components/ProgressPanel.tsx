import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EXTRA_LIST_KIND,
  MAIN_LIST_KIND,
  PROGRESS_BASES,
  PROGRESS_BASIS_LABELS,
  type ChecklistDetail,
  type ChecklistItemView,
  type ChecklistSummary,
  type LibraryEntry,
  type ProgressBasis,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { formatHours } from "../lib/format.js";
import { AchievementsPanel } from "./AchievementsPanel.js";
import { VoteButtons } from "./VoteButtons.js";

/**
 * The "Progress" tab: how far through the game you are, how much play time is
 * left, and every list you keep for it.
 *
 * One list surface, not two. Mission lists used to live here with the time
 * estimate while free-form checklists lived in a separate panel underneath —
 * same data, same table, two different ways to create, publish and copy one.
 * Now there's a main story list (the only one the estimate divides up) and as
 * many extra lists as you want after it, all with the same controls.
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

      <Lists gameId={gameId} entryId={entryId} />
      <AchievementsPanel entryId={entryId} />
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

// ---- lists ----

type NumberedItem = ChecklistItemView & { displayIndex: number };

/**
 * Group entries under their chapter, preserving list order. Chapters are just
 * `checklist_items.category` — an entry with none sorts into the leading
 * unchaptered group, so a flat list still renders as a flat list. Numbering
 * stays continuous across chapters so "mission 24" means the 24th.
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

function Lists({ gameId, entryId }: { gameId: string; entryId: string }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState<"main" | "extra" | null>(null);
  // which section's public-list browser is open — the two are independent
  // panels over the same fetched set, filtered by kind
  const [browsing, setBrowsing] = useState<"main" | "extra" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["progress", entryId] });
    queryClient.invalidateQueries({ queryKey: ["checklists", gameId] });
    // the entry carries the estimate for the "how long to beat" card, and the
    // library list sorts on it
    queryClient.invalidateQueries({ queryKey: ["entry", entryId] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptChecklist(id),
    onSuccess: (copy) => {
      setError(null);
      // the copy is yours now, so show it rather than leaving you looking at
      // the browser you took it from
      setBrowsing(null);
      setOpenId(copy.id);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | 0 | -1 }) => api.voteChecklist(id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklists", gameId] }),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.saveChecklistOrder(gameId, ids),
    onSuccess: invalidate,
  });

  const mine = lists.data?.mine ?? [];
  const main = mine.find((c) => c.kind === MAIN_LIST_KIND) ?? null;
  // everything that isn't the main story, including the legacy 'completion'
  // lists migration 0020 folded in
  const extras = mine.filter((c) => c.kind !== MAIN_LIST_KIND);
  const shared = lists.data?.public ?? [];
  // each section browses the public lists that could fill *it* — copying
  // someone's main story into your side-quest pile isn't a thing anyone means
  const sharedMain = shared.filter((c) => c.kind === MAIN_LIST_KIND);
  const sharedExtra = shared.filter((c) => c.kind !== MAIN_LIST_KIND);

  /** Move an extra list one place, then persist the whole order. */
  const move = (index: number, delta: -1 | 1) => {
    const next = [...extras];
    const target = next[index + delta];
    const current = next[index];
    if (!target || !current) return;
    next[index + delta] = current;
    next[index] = target;
    // the main story list keeps the front, wherever its stored position sits
    reorder.mutate([...(main ? [main.id] : []), ...next.map((c) => c.id)]);
  };

  return (
    <>
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-300">Main story</p>
          <div className="flex flex-wrap items-center gap-2">
            <BrowseButton
              count={sharedMain.length}
              open={browsing === "main"}
              onClick={() => setBrowsing(browsing === "main" ? null : "main")}
            />
            {!main && (
              <button
                onClick={() => setCreating(creating === "main" ? null : "main")}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-500"
              >
                Add missions
              </button>
            )}
          </div>
        </div>

        {browsing === "main" && (
          <PublicLists
            lists={sharedMain}
            emptyNote="Nobody has published a main story list for this game yet. Yours could be the first — publish it from the list's own header."
            error={error}
            busy={adopt.isPending}
            voting={vote.isPending}
            onAdopt={(id) => adopt.mutate(id)}
            onVote={(id, value) => vote.mutate({ id, value })}
          />
        )}

        {creating === "main" && (
          <CreateList
            gameId={gameId}
            kind={MAIN_LIST_KIND}
            defaultTitle="Main story"
            onSaved={() => {
              setCreating(null);
              invalidate();
            }}
          />
        )}

        {main ? (
          <ListCard
            summary={main}
            isMain
            open={openId === main.id}
            onToggleOpen={() => setOpenId(openId === main.id ? null : main.id)}
            onChanged={invalidate}
          />
        ) : (
          creating !== "main" && (
            <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
              No mission list yet — the time estimate needs one.
            </p>
          )
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-300">
            Your other lists
            <span className="ml-2 text-xs font-normal text-zinc-600">(not timed)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <BrowseButton
              count={sharedExtra.length}
              open={browsing === "extra"}
              onClick={() => setBrowsing(browsing === "extra" ? null : "extra")}
            />
            <button
              onClick={() => setCreating(creating === "extra" ? null : "extra")}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              + New list
            </button>
          </div>
        </div>

        {browsing === "extra" && (
          <PublicLists
            lists={sharedExtra}
            emptyNote="No side-quest or collectible lists have been published for this game yet."
            error={error}
            busy={adopt.isPending}
            voting={vote.isPending}
            onAdopt={(id) => adopt.mutate(id)}
            onVote={(id, value) => vote.mutate({ id, value })}
          />
        )}

        {creating === "extra" && (
          <CreateList
            gameId={gameId}
            kind={EXTRA_LIST_KIND}
            defaultTitle=""
            titlePlaceholder="Side quests, Riddler trophies, Endings…"
            onSaved={() => {
              setCreating(null);
              invalidate();
            }}
          />
        )}

        <div className="space-y-2">
          {extras.map((c, i) => (
            <ListCard
              key={c.id}
              summary={c}
              isMain={false}
              open={openId === c.id}
              onToggleOpen={() => setOpenId(openId === c.id ? null : c.id)}
              onChanged={invalidate}
              onMove={extras.length > 1 ? (delta) => move(i, delta) : undefined}
              canMoveUp={i > 0}
              canMoveDown={i < extras.length - 1}
            />
          ))}
          {extras.length === 0 && creating !== "extra" && (
            <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
              Collectibles, endings, side quests — as many as you want, in any order.
            </p>
          )}
        </div>
      </section>

    </>
  );
}

/**
 * "Browse public lists" — the way into other players' work, on both sections
 * rather than only in a block at the bottom of the tab.
 *
 * It's shown even when the count is zero. A button that appears only once
 * someone else has published something can't teach you that sharing exists,
 * and the empty panel is where the invitation to publish your own lives.
 */
function BrowseButton({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Lists other players have published for this game"
      className={`rounded-lg border px-3 py-1.5 text-xs transition ${
        open
          ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
          : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      Browse public lists
      {count > 0 && (
        <span className="ml-1.5 rounded-full bg-indigo-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">
          {count}
        </span>
      )}
    </button>
  );
}

/** The published lists that could fill one section, newest-and-best first. */
function PublicLists({
  lists,
  emptyNote,
  error,
  busy,
  voting,
  onAdopt,
  onVote,
}: {
  lists: ChecklistSummary[];
  emptyNote: string;
  error: string | null;
  busy: boolean;
  voting: boolean;
  onAdopt: (id: string) => void;
  onVote: (id: string, value: 1 | 0 | -1) => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-indigo-900/60 bg-zinc-950/40 p-3">
      <p className="mb-2 text-xs text-zinc-500">
        Published by other players. Saving a copy gives you your own to tick off and edit — the
        original is untouched.
      </p>
      {error && (
        <p className="mb-2 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {error}
        </p>
      )}
      {lists.length === 0 ? (
        <p className="py-2 text-center text-xs text-zinc-600">{emptyNote}</p>
      ) : (
        <div className="space-y-1.5">
          {lists.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{c.title}</p>
                <p className="text-xs text-zinc-500">
                  {c.itemCount} entries{c.authorName ? ` · by ${c.authorName}` : ""}
                </p>
              </div>
              <VoteButtons
                votes={c.votes}
                disabled={voting}
                onVote={(value) => onVote(c.id, value)}
              />
              <button
                onClick={() => onAdopt(c.id)}
                disabled={busy}
                className="shrink-0 rounded-lg border border-indigo-500/50 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
              >
                Save a copy
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One list: tick it off, edit it, publish it, delete it.
 *
 * The main story list is the only one that gets chapters' sequential fill-in
 * and the "sequential" switch — an ordered story implies the missions before
 * it, while a pile of collectibles has no order to imply anything from.
 */
function ListCard({
  summary,
  isMain,
  open,
  onToggleOpen,
  onChanged,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  summary: ChecklistSummary;
  isMain: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onChanged: () => void;
  onMove?: (delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [publishError, setPublishError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["checklist", summary.id],
    queryFn: () => api.getChecklist(summary.id),
    enabled: open,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["checklist", summary.id] });
    onChanged();
  };

  const toggleChapter = (chapter: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(chapter)) next.add(chapter);
      return next;
    });

  const setSequential = useMutation({
    mutationFn: (next: boolean) => api.updateChecklist(summary.id, { sequential: next }),
    onSuccess: refresh,
  });

  const publish = useMutation({
    mutationFn: (isPublic: boolean) => api.updateChecklist(summary.id, { isPublic }),
    onSuccess: () => {
      setPublishError(null);
      refresh();
    },
    // publishing re-scans every entry, so this is where a stray address or
    // slur in a 70-entry list surfaces — say which rule it hit
    onError: (err: Error) => setPublishError(err.message),
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
      if (summary.sequential && completed) {
        const through = items.slice(0, index + 1).filter((it) => !it.completedAt);
        if (through.length > 1) {
          await api.checkChecklistItems(
            summary.id,
            through.map((it) => it.id),
            true,
          );
          return;
        }
      }
      await api.checkChecklistItem(itemId, completed);
    },
    onSuccess: refresh,
  });

  const pct = summary.itemCount > 0 ? Math.round((summary.doneCount / summary.itemCount) * 100) : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      {/*
        Publishing sits on the header beside the title, not on a checkbox in
        the footer: it's the one control here that changes who can see the
        list, and a tickbox buried under seventy missions read as a setting
        rather than as an action. It's also reachable without opening the list.
      */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggleOpen}
          className="flex min-w-0 shrink items-center gap-2 text-left"
        >
          <span className="shrink-0 text-xs text-zinc-600">{open ? "▾" : "▸"}</span>
          <span className="truncate text-sm text-zinc-200">{summary.title}</span>
        </button>
        {summary.adoptedFromId && (
          <span
            className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500"
            title="Your own copy — edits here don't affect the original"
          >
            copied
          </span>
        )}
        <button
          onClick={() => publish.mutate(!summary.isPublic)}
          disabled={publish.isPending}
          title={
            summary.isPublic
              ? "Published — other players can find this list on this game and take their own copy. Click to unpublish."
              : "Publish so anyone can find this list on this game and take their own copy"
          }
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            summary.isPublic
              ? "border-emerald-600/60 bg-emerald-950 text-emerald-300 hover:bg-emerald-900/60"
              : "border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/20"
          }`}
        >
          {publish.isPending ? "…" : summary.isPublic ? "✓ Published" : "Publish"}
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="text-xs text-zinc-500">
            {summary.doneCount}/{summary.itemCount}
          </span>
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800 sm:block">
            <span
              className="block h-full rounded-full bg-indigo-500"
              style={{ width: `${pct}%` }}
            />
          </span>
          {onMove && (
            <span className="flex flex-col leading-none">
              <button
                onClick={() => onMove(-1)}
                disabled={!canMoveUp}
                title="Move list up"
                className="px-1 text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-20"
              >
                ▲
              </button>
              <button
                onClick={() => onMove(1)}
                disabled={!canMoveDown}
                title="Move list down"
                className="px-1 text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-20"
              >
                ▼
              </button>
            </span>
          )}
        </div>
      </div>

      {/* publishing works while the list is collapsed, so its errors — a slur
          or an address caught in one of seventy entries — can't live inside
          the open body */}
      {publishError && (
        <p className="mx-3 mb-2 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {publishError}
        </p>
      )}

      {open && (
        <div className="border-t border-zinc-800 px-3 py-2">
          {editing && detail.data ? (
            <MissionEditor
              detail={detail.data}
              showChapters
              onChanged={refresh}
              onDeleted={() => {
                setEditing(false);
                onChanged();
              }}
            />
          ) : (
            <>
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
                  Empty — use “Edit list” to add entries.
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
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800/60 pt-2">
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300"
            >
              {editing ? "✓ Done editing" : "✎ Edit list"}
            </button>
            {isMain && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400"
                title="Story missions are played in order, so ticking one fills in everything before it. Untick a single mission if you skipped it."
              >
                <input
                  type="checkbox"
                  checked={summary.sequential}
                  onChange={(ev) => setSequential.mutate(ev.target.checked)}
                />
                Sequential
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Edit an existing list: rename it, fix or reorder entries, add ones you
 * missed, or delete the list outright.
 */
function MissionEditor({
  detail,
  showChapters,
  onChanged,
  onDeleted,
}: {
  detail: ChecklistDetail;
  showChapters: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(detail.title);
  const [newMission, setNewMission] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const items = detail.items;
  // chapters exist by being named on an entry — no empty-chapter concept to
  // keep in sync. This feeds the datalist so names stay consistent.
  const chapters = [
    ...new Set(items.map((i) => i.category?.trim()).filter((c): c is string => !!c)),
  ];
  const refresh = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["checklist", detail.id] });
    onChanged();
  };
  const fail = (err: Error) => setError(err.message);

  const rename = useMutation({
    mutationFn: (next: string) => api.updateChecklist(detail.id, { title: next }),
    onSuccess: refresh,
    onError: fail,
  });
  const addItem = useMutation({
    mutationFn: ({ text, category }: { text: string; category: string | null }) =>
      api.addChecklistItem(detail.id, { text, category }),
    onSuccess: () => {
      setNewMission("");
      refresh();
    },
    onError: fail,
  });
  const editItem = useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) =>
      api.updateChecklistItem(itemId, { text }),
    onSuccess: refresh,
    onError: fail,
  });
  /** Move an entry into a chapter, or clear it by saving an empty name. */
  const setChapter = useMutation({
    mutationFn: ({ itemId, category }: { itemId: string; category: string | null }) =>
      api.updateChecklistItem(itemId, { category }),
    onSuccess: refresh,
    onError: fail,
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
   * Reorder by swapping the two entries' stored positions, rather than
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
    <div className="rounded-lg border border-indigo-900/60 bg-zinc-950/40 p-3">
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

      {error && (
        <p className="mt-2 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {error}
        </p>
      )}

      {showChapters && (
        <p className="mt-2 text-xs text-zinc-600">
          Chapters group a list. Type a name in an entry's chapter box — a new name creates the
          chapter, and clearing it moves the entry out again.
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
            showChapter={showChapters}
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
            Nothing here yet — add an entry below, or delete the list.
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
        {showChapters && (
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
        <span className="text-xs text-zinc-600">{items.length} entries</span>
        <button
          onClick={() => {
            if (
              confirm(`Delete the list "${detail.title}"? Your ticked-off progress goes with it.`)
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
        title="Delete entry"
        className="shrink-0 px-1 text-xs text-zinc-600 hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * How a list gets created: name it and paste one in, name it and say how many
 * entries it has, or name it and start empty.
 *
 * Pasting used to be the fallback behind a wiki scraper. The scraper is gone —
 * it was right on two of six test games — so this is the main event now, which
 * is also what makes a list worth publishing for everyone else.
 */
function CreateList({
  gameId,
  kind,
  defaultTitle,
  titlePlaceholder,
  onSaved,
}: {
  gameId: string;
  kind: typeof MAIN_LIST_KIND | typeof EXTRA_LIST_KIND;
  defaultTitle: string;
  titlePlaceholder?: string;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [text, setText] = useState("");
  const [count, setCount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const name = title.trim() || defaultTitle || "Untitled list";

  const save = useMutation({
    mutationFn: (missions: string[]) =>
      missions.length > 0
        ? api.importMissions(gameId, { title: name, missions, kind })
        : api.createChecklist(gameId, name, kind),
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  const pasted = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter(Boolean);

  const n = Number(count);
  const slotName = kind === MAIN_LIST_KIND ? "Mission" : "Entry";
  const numbered =
    Number.isInteger(n) && n > 0 && n <= 500
      ? Array.from({ length: n }, (_, i) => `${slotName} ${i + 1}`)
      : [];

  return (
    <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <input
        value={title}
        onChange={(ev) => setTitle(ev.target.value)}
        placeholder={titlePlaceholder ?? "List name"}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
      />
      <p className="mt-3 text-xs text-zinc-500">
        Paste the entries (one per line), enter how many there are, or start empty and add them
        as you go.
      </p>
      <textarea
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        rows={4}
        placeholder={"Phantom Limbs\nDiamond Dogs\n…"}
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />

      {error && (
        <p className="mt-2 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          {error}
        </p>
      )}

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
          Create numbered
        </button>
        <span className="text-xs text-zinc-600">or</span>
        <button
          onClick={() => save.mutate([])}
          disabled={save.isPending}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Start empty
        </button>
      </div>
    </div>
  );
}
