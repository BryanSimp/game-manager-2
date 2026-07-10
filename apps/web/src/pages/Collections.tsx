import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.getCollections() });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createCollection({ name: name.trim() }),
    onSuccess: () => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create"),
  });

  return (
    <Shell>
      <h1 className="mb-1 text-xl font-bold">Collections</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Group games into franchises or marathons, and map out what order to play them with the
        play-order graph.
      </p>

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
          <Link
            key={c.id}
            to="/collection/$id"
            params={{ id: c.id }}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-600"
            style={c.accentColor ? { borderColor: `${c.accentColor}66` } : undefined}
          >
            <h2 className="font-semibold" style={c.accentColor ? { color: c.accentColor } : undefined}>
              {c.name}
            </h2>
            {c.description && (
              <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{c.description}</p>
            )}
            <div className="mt-4 flex items-center gap-3 text-sm text-zinc-400">
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
        ))}
      </div>
    </Shell>
  );
}
