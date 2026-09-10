import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionSummary } from "@gm/shared";
import { api } from "../lib/api.js";

const DEFAULT_ACCENT = "#818cf8";

/**
 * Put a game in a collection from wherever the game already is.
 *
 * Filing a game used to run the wrong way round: you opened Collections,
 * opened the right one, and searched for a game you had just been looking at.
 * This is the same membership seen from the game's end — the collections it's
 * in are chips you can take it out of, and everything else is one click away,
 * including a collection that doesn't exist yet.
 *
 * `gameId` is the *catalog* game, not a library entry, because a collection is
 * a reading list rather than an inventory: this works just as well on a game
 * you don't own.
 */
export function CollectionPicker({ gameId }: { gameId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // keyed under ["collections"] so every collection write already in the app
  // invalidates this list too — the prefix matches
  const collections = useQuery({
    queryKey: ["collections", gameId],
    queryFn: () => api.getCollections({ gameId }),
  });

  function settled(collectionId: string) {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["collections"] });
    queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
    // "In public collections" on the game page counts membership too
    queryClient.invalidateQueries({ queryKey: ["public-collections"] });
  }

  function failed(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  const add = useMutation({
    mutationFn: (collectionId: string) => api.addCollectionGame(collectionId, { gameId }),
    onSuccess: (_result, collectionId) => {
      setOpen(false);
      settled(collectionId);
    },
    onError: (err) => failed(err, "Couldn't add it to that collection"),
  });

  const remove = useMutation({
    mutationFn: (collectionId: string) => api.removeCollectionGame(collectionId, gameId),
    onSuccess: (_result, collectionId) => settled(collectionId),
    onError: (err) => failed(err, "Couldn't take it out of that collection"),
  });

  const create = useMutation({
    mutationFn: async (collectionName: string) => {
      const collection = await api.createCollection({ name: collectionName });
      await api.addCollectionGame(collection.id, { gameId });
      return collection;
    },
    onSuccess: (collection) => {
      setName("");
      setOpen(false);
      settled(collection.id);
    },
    onError: (err) => failed(err, "Couldn't create that collection"),
  });

  const busy = add.isPending || remove.isPending || create.isPending;
  const all = collections.data ?? [];
  const holding = all.filter((c) => c.containsGame);
  const rest = all.filter((c) => !c.containsGame);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {holding.map((c) => (
          <CollectionChip
            key={c.id}
            collection={c}
            busy={busy}
            onRemove={() => remove.mutate(c.id)}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
          className={`rounded-full border border-dashed px-3 py-1 text-xs font-medium transition ${
            open
              ? "border-indigo-500 text-indigo-300"
              : "border-zinc-700 text-zinc-400 hover:border-indigo-500 hover:text-indigo-300"
          }`}
        >
          {holding.length > 0 ? "＋ Another collection" : "＋ Add to collection"}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2">
          {collections.isLoading && <p className="px-1 py-1 text-xs text-zinc-500">Loading…</p>}
          {!collections.isLoading && rest.length === 0 && (
            <p className="px-1 py-1 text-xs text-zinc-500">
              {all.length === 0
                ? "You haven't made a collection yet — name one below."
                : "It's already in every collection you have."}
            </p>
          )}
          {rest.length > 0 && (
            <div className="max-h-44 overflow-y-auto">
              {rest.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => add.mutate(c.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800 disabled:opacity-50"
                >
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ backgroundColor: c.accentColor ?? DEFAULT_ACCENT }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {c.isPublic && <span className="mr-1 text-amber-400">★</span>}
                    {c.name}
                  </span>
                  <span className="flex-none text-xs text-zinc-500">{c.total}</span>
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
            className="mt-1.5 flex gap-1.5 border-t border-zinc-800 pt-2"
          >
            <input
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="New collection…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!name.trim() || busy}
              className="flex-none rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {create.isPending ? "Adding…" : "Create"}
            </button>
          </form>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function CollectionChip({
  collection,
  busy,
  onRemove,
}: {
  collection: CollectionSummary;
  busy: boolean;
  onRemove: () => void;
}) {
  const accent = collection.accentColor ?? DEFAULT_ACCENT;
  return (
    <span
      className="inline-flex items-center overflow-hidden rounded-full border text-xs font-medium"
      style={{ borderColor: `${accent}66`, backgroundColor: `${accent}1a`, color: accent }}
    >
      <Link
        to="/collection/$id"
        params={{ id: collection.id }}
        title={`Open ${collection.name}`}
        className="max-w-[11rem] truncate py-1 pl-3 pr-1.5 hover:underline"
      >
        {collection.isPublic && <span className="mr-1 text-amber-400">★</span>}
        {collection.name}
      </Link>
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        title="Take it out of this collection"
        className="py-1 pl-0.5 pr-2.5 text-zinc-400 hover:text-red-300 disabled:opacity-50"
      >
        ✕
      </button>
    </span>
  );
}
