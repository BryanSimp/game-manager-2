import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionSummary, PublicCollection } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { AddCollectionToLibrary } from "../components/AddCollectionToLibrary.js";
import { CollectionTimeLine } from "../components/CollectionTime.js";
import { CreateCollection } from "../components/CreateCollection.js";
import { VoteButtons } from "../components/VoteButtons.js";

type Tab = "mine" | "public";

/** Settle a value before it becomes a query key, so typing isn't a request each. */
function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value.trim()), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"top" | "new">("top");

  // typing shouldn't fire a query per keystroke
  const debouncedSearch = useDebounced(search, 300);

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });
  const publicOnes = useQuery({
    queryKey: ["public-collections", debouncedSearch, sort],
    queryFn: () => api.getPublicCollections({ q: debouncedSearch || undefined, sort }),
    enabled: tab === "public",
  });

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptCollection(id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
      navigate({ to: "/collection/$id", params: { id: created.id } });
    },
  });

  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | 0 | -1 }) => api.voteCollection(id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["public-collections"] }),
  });

  const hasMore = publicOnes.data?.hasMore ?? false;

  return (
    <Shell>
      <h1 className="mb-1 text-xl font-bold">Collections</h1>
      <p className="mb-5 text-sm text-zinc-400">
        Group games into franchises or marathons, and map out what order to play them with the
        play-order graph. Publish one and anyone can take their own copy.
      </p>

      <div className="mb-6 flex gap-2">
        {(
          [
            { key: "mine", label: "Yours" },
            { key: "public", label: "★ Public" },
          ] as Array<{ key: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mine" ? (
        <>
          <CreateCollection />

          {collections.data?.length === 0 && (
            <p className="text-zinc-500">No collections yet — create your first one above.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.data?.map((c) => (
              <MineCard key={c.id} collection={c} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by collection or game — e.g. Zelda"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500 sm:max-w-md"
            />
            <div className="flex gap-1 rounded-lg border border-zinc-700 p-0.5">
              {(
                [
                  { key: "top", label: "Top rated" },
                  { key: "new", label: "Newest" },
                ] as Array<{ key: "top" | "new"; label: string }>
              ).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    sort === s.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {publicOnes.isLoading && <p className="text-zinc-500">Loading…</p>}
          {publicOnes.data?.items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 p-10 text-center">
              <p className="mb-2 font-semibold">
                {debouncedSearch ? "Nothing matches that" : "Nothing published yet"}
              </p>
              <p className="text-sm text-zinc-400">
                {debouncedSearch
                  ? "Try a game name — the search looks inside collections too."
                  : "Open one of your collections and hit Publish to share it."}
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicOnes.data?.items.map((c) => (
              <PublicCard
                key={c.id}
                collection={c}
                busy={adopt.isPending}
                onAdopt={() => adopt.mutate(c.id)}
                onVote={(value) => vote.mutate({ id: c.id, value })}
              />
            ))}
          </div>
          {hasMore && (
            <p className="mt-4 text-center text-xs text-zinc-600">
              More than {publicOnes.data?.items.length} match — narrow the search to see the rest.
            </p>
          )}
          {adopt.isError && (
            <p className="mt-4 text-sm text-red-400">
              {adopt.error instanceof Error ? adopt.error.message : "Couldn't copy that collection"}
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

/** Row of cover thumbnails; the same shape on both card kinds. */
function Covers({ preview }: { preview: Array<{ gameId: string; coverSrc: string | null }> }) {
  if (preview.length === 0) return null;
  return (
    <div className="mt-3 flex gap-1.5">
      {preview.map((g) => (
        <div key={g.gameId} className="h-14 w-10 flex-none overflow-hidden rounded bg-zinc-800">
          {g.coverSrc && <img src={g.coverSrc} alt="" className="h-full w-full object-cover" />}
        </div>
      ))}
    </div>
  );
}

function MineCard({ collection: c }: { collection: CollectionSummary }) {
  return (
    <Link
      to="/collection/$id"
      params={{ id: c.id }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-600"
      style={c.accentColor ? { borderColor: `${c.accentColor}66` } : undefined}
    >
      <h2
        className="flex items-center gap-2 font-semibold"
        style={c.accentColor ? { color: c.accentColor } : undefined}
      >
        {c.isPublic && (
          <span className="text-amber-400" title="Published">
            ★
          </span>
        )}
        <span className="min-w-0 truncate">{c.name}</span>
        {c.adoptedFromId && (
          <span className="flex-none rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-normal text-zinc-500">
            copied
          </span>
        )}
      </h2>
      {c.description && <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.description}</p>}
      <Covers preview={c.preview} />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
        <span>{c.total} games</span>
        <span className="text-emerald-400">{c.finished} finished</span>
        <CollectionTimeLine time={c.time} />
      </div>
      {c.total > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${(c.finished / c.total) * 100}%` }}
          />
        </div>
      )}
    </Link>
  );
}

function PublicCard({
  collection: c,
  busy,
  onAdopt,
  onVote,
}: {
  collection: PublicCollection;
  busy: boolean;
  onAdopt: () => void;
  onVote: (value: 1 | 0 | -1) => void;
}) {
  return (
    <div
      className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
      style={c.accentColor ? { borderColor: `${c.accentColor}66` } : undefined}
    >
      <h2
        className="flex items-center gap-2 font-semibold"
        style={c.accentColor ? { color: c.accentColor } : undefined}
      >
        <span className="text-amber-400">★</span>
        <span className="min-w-0 truncate">{c.name}</span>
      </h2>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-zinc-500">
          by {c.mine ? "you" : c.authorName} · {c.total} games
        </p>
        {/* your own collection has no vote control — the API refuses it, and
            a score you can pad isn't a score */}
        {!c.mine && <VoteButtons votes={c.votes} onVote={onVote} />}
      </div>
      {c.description && <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.description}</p>}
      <Covers preview={c.preview} />
      {/* the length of someone else's marathon is most of what you want to
          know before copying it */}
      <p className="mt-3 text-sm">
        <CollectionTimeLine time={c.time} />
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {c.mine ? (
          <Link
            to="/collection/$id"
            params={{ id: c.id }}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            Open yours
          </Link>
        ) : (
          <button
            onClick={onAdopt}
            disabled={busy}
            title="Takes a private copy you can edit — the original is untouched"
            className="rounded-lg border border-indigo-500/50 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50"
          >
            {c.adopted ? "Save another copy" : "Save a copy"}
          </button>
        )}
        <AddCollectionToLibrary collectionId={c.id} total={c.total} />
      </div>
    </div>
  );
}
