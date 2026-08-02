import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionSummary, PublicCollection } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

type Tab = "mine" | "public";

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("mine");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });
  const publicOnes = useQuery({
    queryKey: ["public-collections"],
    queryFn: () => api.getPublicCollections(),
    enabled: tab === "public",
  });

  const create = useMutation({
    mutationFn: () => api.createCollection({ name: name.trim() }),
    onSuccess: () => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create"),
  });

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptCollection(id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
      navigate({ to: "/collection/$id", params: { id: created.id } });
    },
  });

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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            className="mb-8 flex max-w-md gap-3"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Legend of Zelda"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              Create
            </button>
          </form>
          {error && <p className="-mt-4 mb-6 text-sm text-red-400">{error}</p>}

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
          {publicOnes.isLoading && <p className="text-zinc-500">Loading…</p>}
          {publicOnes.data?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 p-10 text-center">
              <p className="mb-2 font-semibold">Nothing published yet</p>
              <p className="text-sm text-zinc-400">
                Open one of your collections and hit Publish to share it.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicOnes.data?.map((c) => (
              <PublicCard
                key={c.id}
                collection={c}
                busy={adopt.isPending}
                onAdopt={() => adopt.mutate(c.id)}
              />
            ))}
          </div>
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
      <div className="mt-3 flex items-center gap-3 text-sm text-zinc-400">
        <span>{c.total} games</span>
        <span className="text-emerald-400">{c.finished} finished</span>
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
}: {
  collection: PublicCollection;
  busy: boolean;
  onAdopt: () => void;
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
      <p className="mt-1 text-xs text-zinc-500">
        by {c.mine ? "you" : c.authorName} · {c.total} games
      </p>
      {c.description && <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.description}</p>}
      <Covers preview={c.preview} />
      <div className="mt-auto pt-4">
        {c.mine ? (
          <Link
            to="/collection/$id"
            params={{ id: c.id }}
            className="inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
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
      </div>
    </div>
  );
}
