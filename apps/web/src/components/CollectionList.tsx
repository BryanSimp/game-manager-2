import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CollectionNode } from "@gm/shared";
import { api } from "../lib/api.js";
import { formatHours, statusChip, statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { usePreferences } from "../lib/prefs.js";

export type ListSort = "custom" | "title" | "release" | "ttb";

export const LIST_SORTS: Array<{ key: ListSort; label: string }> = [
  { key: "custom", label: "Custom order" },
  { key: "title", label: "Title" },
  { key: "release", label: "Release date" },
  { key: "ttb", label: "Time to beat" },
];

/**
 * Sort a collection's games for the list view.
 *
 * "Custom order" is the one you set by hand (`sortOrder`); the other three are
 * derived. Games missing the field a sort needs sink to the bottom rather than
 * jumbling into the middle — an unknown release date isn't "the year 0".
 */
export function sortNodes(games: CollectionNode[], sort: ListSort): CollectionNode[] {
  const byTitle = (a: CollectionNode, b: CollectionNode) => a.title.localeCompare(b.title);
  return [...games].sort((a, b) => {
    if (sort === "title") return byTitle(a, b);
    if (sort === "release") {
      if (!a.releaseDate && !b.releaseDate) return byTitle(a, b);
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate) || byTitle(a, b);
    }
    if (sort === "ttb") {
      const av = a.ttbMain ?? Number.MAX_SAFE_INTEGER;
      const bv = b.ttbMain ?? Number.MAX_SAFE_INTEGER;
      return av - bv || byTitle(a, b);
    }
    return a.sortOrder - b.sortOrder || byTitle(a, b);
  });
}

/**
 * The flat list view of a collection: a numbered run of games you can sort,
 * reorder by hand, and click through to.
 *
 * Reordering is only offered on "Custom order" — dragging a row while sorted
 * by title would have nowhere to save to.
 */
export function CollectionList({
  collectionId,
  games,
  accent,
}: {
  collectionId: string;
  games: CollectionNode[];
  accent: string;
}) {
  const queryClient = useQueryClient();
  const prefs = usePreferences();
  const categories = useCategories();
  const [sort, setSort] = useState<ListSort>("custom");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CollectionNode[] | null>(null);

  const sorted = useMemo(() => sortNodes(games, sort), [games, sort]);
  const rows = editing && draft ? draft : sorted;

  const saveOrder = useMutation({
    mutationFn: (ordered: CollectionNode[]) =>
      api.saveCollectionOrder(
        collectionId,
        ordered.map((g) => g.gameId),
      ),
    onSuccess: () => {
      setEditing(false);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  function move(index: number, delta: number) {
    const next = [...(draft ?? sorted)];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Sort</span>
        {LIST_SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setSort(s.key);
              if (s.key !== "custom") {
                setEditing(false);
                setDraft(null);
              }
            }}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              sort === s.key
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {s.label}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {sort === "custom" &&
            (editing ? (
              <>
                <button
                  onClick={() => saveOrder.mutate(draft ?? sorted)}
                  disabled={saveOrder.isPending}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saveOrder.isPending ? "Saving…" : "Save order"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setDraft(null);
                  }}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setDraft(sorted);
                  setEditing(true);
                }}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Edit order
              </button>
            ))}
        </div>
      </div>

      {editing && (
        <p className="mb-3 text-xs text-zinc-500">
          Use the arrows to set the play order, then save. Rows don't open while you're editing.
        </p>
      )}

      <ol className="space-y-2">
        {rows.map((game, index) => {
          const chip = game.status ? statusChip(game.status, prefs, categories) : null;
          const body = (
            <>
              <span
                className="w-7 flex-none text-right text-sm font-bold tabular-nums"
                style={{ color: accent }}
              >
                {index + 1}
              </span>
              <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-800">
                {game.coverSrc && (
                  <img src={game.coverSrc} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-100">{game.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {game.releaseDate && <span>{game.releaseDate.slice(0, 4)}</span>}
                  {game.ttbMain && <span>⏱ {formatHours(game.ttbMain)}</span>}
                  {chip ? (
                    <span
                      className={`${chip.className} rounded-full px-2 py-0.5`}
                      style={chip.style}
                    >
                      {statusLabel(game.status!, categories)}
                    </span>
                  ) : (
                    <span className="rounded-full border border-dashed border-zinc-700 px-2 py-0.5">
                      Not in your library
                    </span>
                  )}
                </div>
              </div>
            </>
          );

          if (editing) {
            return (
              <li
                key={game.gameId}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
              >
                {body}
                <div className="flex flex-none flex-col gap-1">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label="Move down"
                    className="rounded border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              </li>
            );
          }

          // not editing: the row is a link — to your copy if you own it, or to
          // the add-game search if you don't
          return (
            <li key={game.gameId}>
              {game.userGameId ? (
                <Link
                  to="/game/$id"
                  params={{ id: game.userGameId }}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 transition hover:border-zinc-600"
                >
                  {body}
                  <span className="flex-none text-sm text-zinc-600">›</span>
                </Link>
              ) : (
                <Link
                  to="/add"
                  search={{ q: game.title }}
                  title="You don't own this yet — opens the add-game search"
                  className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/60 p-3 transition hover:border-indigo-600"
                >
                  {body}
                  <span className="flex-none text-xs font-semibold text-indigo-400">+ Add</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {saveOrder.isError && (
        <p className="mt-3 text-sm text-red-400">
          {saveOrder.error instanceof Error ? saveOrder.error.message : "Couldn't save the order"}
        </p>
      )}
    </div>
  );
}
