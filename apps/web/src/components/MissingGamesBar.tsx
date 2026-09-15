import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AddCollectionToLibraryResult, CollectionNode } from "@gm/shared";
import { api } from "../lib/api.js";
import { statusLabel } from "../lib/format.js";
import { useCategories } from "../lib/categories.js";
import { Dropdown, DropdownItem } from "./Dropdown.js";

/** the two categories almost everyone means when they add games they don't have */
const QUICK = ["wishlist", "backlog"] as const;

/**
 * "These games are in the collection but not in your library — add them."
 *
 * Two ways in, both a click from the category. **All of them**: Wishlist and
 * Backlog as buttons, because that's where games you haven't got go, and every
 * other category (custom ones included) in a menu beside them. **Some of
 * them**: *Choose games* turns the list's rows into checkboxes, and the same
 * three controls then act on just the ones you ticked.
 *
 * It only ever sends the games you don't own, by id. The server's add-all
 * applies a chosen platform to games you already have as well, which is right
 * for "I own this marathon on Switch" but not for "wishlist the ones I'm
 * missing" — naming the missing ones keeps your own copies out of it.
 *
 * Selection state lives on the page, because the checkboxes are drawn by the
 * list and the buttons are drawn here.
 */
export function MissingGamesBar({
  collectionId,
  games,
  selecting,
  selected,
  onStartSelecting,
  onStopSelecting,
  onSelect,
}: {
  collectionId: string;
  games: CollectionNode[];
  selecting: boolean;
  selected: Set<string>;
  onStartSelecting: () => void;
  onStopSelecting: () => void;
  onSelect: (gameIds: Set<string>) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [result, setResult] = useState<{ status: string; outcome: AddCollectionToLibraryResult } | null>(
    null,
  );

  const missing = games.filter((g) => !g.userGameId);
  // a stale selection can outlive a game that was added from elsewhere
  const chosen = missing.filter((g) => selected.has(g.gameId));
  const targets = selecting ? chosen : missing;

  const add = useMutation({
    mutationFn: (status: string) =>
      api.addCollectionToLibrary(collectionId, {
        status,
        gameIds: targets.map((g) => g.gameId),
      }),
    onMutate: () => setResult(null),
    onSuccess: (outcome, status) => {
      setResult({ status, outcome });
      onStopSelecting();
      queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Nothing missing and nothing to report: the bar has no job. It stays up
  // after adding the last of them, to say that it worked.
  if (missing.length === 0 && !result) return null;

  const others = (categories ?? []).filter(
    (c) => !(QUICK as readonly string[]).includes(c.key),
  );
  const count = targets.length;
  const disabled = count === 0 || add.isPending;
  const quickLabel = (key: string) =>
    selecting ? `Add ${count} to ${statusLabel(key, categories)}` : `Add all to ${statusLabel(key, categories)}`;

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 ${
        selecting ? "border-indigo-900 bg-indigo-950/40" : "border-emerald-900/60 bg-emerald-950/20"
      }`}
    >
      {missing.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="mr-auto text-sm text-zinc-200">
              {selecting ? (
                <>
                  <span className="font-semibold text-indigo-200">
                    {chosen.length} of {missing.length}
                  </span>{" "}
                  selected — tick the games you want below.
                </>
              ) : (
                <>
                  <span className="font-semibold text-emerald-300">
                    {missing.length} of {games.length}
                  </span>{" "}
                  {missing.length === 1 ? "game here isn't" : "games here aren't"} in your library.
                </>
              )}
            </p>
            {selecting ? (
              <>
                <button
                  onClick={() => onSelect(new Set(missing.map((g) => g.gameId)))}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Select all
                </button>
                <button
                  onClick={() => onSelect(new Set())}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Clear
                </button>
                <button
                  onClick={onStopSelecting}
                  className="rounded-lg px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setResult(null);
                  onStartSelecting();
                }}
                className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                ☑ Choose games
              </button>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {QUICK.map((key) => (
              <button
                key={key}
                onClick={() => add.mutate(key)}
                disabled={disabled}
                className="rounded-lg border border-emerald-600/50 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/15 disabled:opacity-40"
              >
                + {quickLabel(key)}
              </button>
            ))}
            <Dropdown
              label={selecting ? `Add ${count} to…` : "Add all to…"}
              disabled={disabled || others.length === 0}
              widthClassName="w-56"
              buttonClassName="inline-flex items-center rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              {(close) =>
                others.map((c) => (
                  <DropdownItem
                    key={c.key}
                    onSelect={() => {
                      close();
                      add.mutate(c.key);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.label}
                    </span>
                  </DropdownItem>
                ))
              }
            </Dropdown>
            {add.isPending && <span className="text-xs text-zinc-400">Adding…</span>}
          </div>
        </>
      )}

      {result && (
        <p
          className={`flex items-start gap-2 text-xs text-emerald-400 ${missing.length > 0 ? "mt-2.5" : ""}`}
        >
          <span className="mr-auto">
            ✓ Added {result.outcome.added} to {statusLabel(result.status, categories)}
            {result.outcome.skipped > 0 && ` · ${result.outcome.skipped} already yours`}
            {result.outcome.errors.length > 0 && (
              <span className="text-red-400"> · {result.outcome.errors.length} failed</span>
            )}
            {missing.length === 0 && " — every game in this collection is in your library now."}
          </span>
          <button
            onClick={() => setResult(null)}
            aria-label="Dismiss"
            className="text-zinc-500 hover:text-zinc-300"
          >
            ✕
          </button>
        </p>
      )}
      {add.isError && (
        <p className="mt-2 text-xs text-red-400">
          {add.error instanceof Error ? add.error.message : "Couldn't add those games"}
        </p>
      )}
    </div>
  );
}
