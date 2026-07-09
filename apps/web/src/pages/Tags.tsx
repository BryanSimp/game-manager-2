import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

const SWATCHES = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#f97316"];

export function TagsPage() {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.getTags() });

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SWATCHES[0]!);
  const [group, setGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createTag({ name: name.trim(), color, groupName: group.trim() || null }),
    onSuccess: () => {
      setName("");
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create tag"),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Tag> }) => api.updateTag(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: invalidate,
  });

  // group tags by groupName (null group last, shown as "Ungrouped")
  const groups = new Map<string, Tag[]>();
  for (const t of tags.data ?? []) {
    const key = t.groupName ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <Shell>
      <h1 className="mb-1 text-xl font-bold">Tags</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Create your own categories — moods, franchises, co-op, "play with friends", anything.
        Optional groups keep related tags together.
      </p>

      <div className="mb-8 max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-zinc-400">Tag name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cozy"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <label className="w-40">
            <span className="mb-1 block text-xs text-zinc-400">Group (optional)</span>
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="e.g. Mood"
              list="tag-groups"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <datalist id="tag-groups">
              {[...groups.keys()].filter(Boolean).map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            Create tag
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s}
              onClick={() => setColor(s)}
              className={`h-6 w-6 rounded-full border-2 ${color === s ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: s }}
              aria-label={`color ${s}`}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
            title="Custom color"
          />
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {tags.data?.length === 0 && (
        <p className="text-zinc-500">No tags yet — create your first one above.</p>
      )}

      {[...groups.entries()]
        .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
        .map(([groupName, list]) => (
          <section key={groupName || "ungrouped"} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {groupName || "Ungrouped"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {list.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 py-1 pl-1.5 pr-1 text-sm"
                >
                  <label className="relative h-4 w-4 cursor-pointer">
                    <span
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: t.color ?? "#71717a" }}
                    />
                    <input
                      type="color"
                      value={t.color ?? "#71717a"}
                      onChange={(e) => update.mutate({ id: t.id, patch: { color: e.target.value } })}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      title="Change color"
                    />
                  </label>
                  {t.name}
                  <button
                    onClick={() => {
                      if (confirm(`Delete tag "${t.name}"? It will be removed from all games.`))
                        remove.mutate(t.id);
                    }}
                    className="rounded-full px-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                    title="Delete tag"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>
        ))}
    </Shell>
  );
}
