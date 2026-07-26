import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChecklistSummary } from "@gm/shared";
import { api } from "../lib/api.js";

/** Completionist checklists for one game: mine (trackable) + public templates. */
export function ChecklistPanel({ gameId }: { gameId: string }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const lists = useQuery({
    queryKey: ["checklists", gameId],
    queryFn: () => api.getGameChecklists(gameId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["checklists", gameId] });
    if (openId) queryClient.invalidateQueries({ queryKey: ["checklist", openId] });
  };

  const create = useMutation({
    mutationFn: (title: string) => api.createChecklist(gameId, title),
    onSuccess: (created) => {
      setNewTitle("");
      setOpenId(created.id);
      invalidate();
    },
  });

  const adopt = useMutation({
    mutationFn: (id: string) => api.adoptChecklist(id),
    onSuccess: (copy) => {
      setOpenId(copy.id);
      invalidate();
    },
  });

  const data = lists.data;
  if (!data) return null;

  // mission lists are rendered by ProgressPanel with their time estimate
  const mine = data.mine.filter((c) => c.kind === "completion");
  const shared = data.public.filter((c) => c.kind === "completion");

  return (
    <div className="mt-6 max-w-2xl">
      <p className="mb-2 text-sm font-semibold text-zinc-300">Completionist checklists</p>

      <div className="space-y-2">
        {mine.map((c) => (
          <ChecklistCard
            key={c.id}
            summary={c}
            open={openId === c.id}
            onToggleOpen={() => setOpenId(openId === c.id ? null : c.id)}
            onChanged={invalidate}
          />
        ))}

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (newTitle.trim()) create.mutate(newTitle.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={newTitle}
            onChange={(ev) => setNewTitle(ev.target.value)}
            placeholder="New checklist (e.g. All shrines, Endings)…"
            className="flex-1 rounded-lg border border-dashed border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
          />
          {newTitle.trim() && (
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500"
            >
              Create
            </button>
          )}
        </form>

        {shared.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-zinc-600">
              Shared by other players
            </p>
            {shared.map((c) => (
              <div
                key={c.id}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">{c.title}</p>
                  <p className="text-xs text-zinc-500">
                    {c.itemCount} items{c.authorName ? ` · by ${c.authorName}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => adopt.mutate(c.id)}
                  disabled={adopt.isPending}
                  className="ml-3 shrink-0 rounded-lg border border-indigo-500/50 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/20"
                >
                  Adopt a copy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistCard({
  summary,
  open,
  onToggleOpen,
  onChanged,
}: {
  summary: ChecklistSummary;
  open: boolean;
  onToggleOpen: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const detail = useQuery({
    queryKey: ["checklist", summary.id],
    queryFn: () => api.getChecklist(summary.id),
    enabled: open,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["checklist", summary.id] });
    onChanged();
  };

  const check = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      api.checkChecklistItem(itemId, completed),
    onSuccess: refresh,
  });
  const addItem = useMutation({
    mutationFn: () =>
      api.addChecklistItem(summary.id, {
        text: newItem.trim(),
        category: newCategory.trim() || null,
      }),
    onSuccess: () => {
      setNewItem("");
      refresh();
    },
  });
  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.deleteChecklistItem(itemId),
    onSuccess: refresh,
  });
  const publish = useMutation({
    mutationFn: (isPublic: boolean) => api.updateChecklist(summary.id, { isPublic }),
    onSuccess: refresh,
  });
  const removeList = useMutation({
    mutationFn: () => api.deleteChecklist(summary.id),
    onSuccess: onChanged,
  });

  const pct = summary.itemCount > 0 ? Math.round((summary.doneCount / summary.itemCount) * 100) : 0;

  const grouped = new Map<string, NonNullable<typeof detail.data>["items"]>();
  for (const item of detail.data?.items ?? []) {
    const key = item.category ?? "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <button onClick={onToggleOpen} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-zinc-200">
            {summary.title}
            {summary.isPublic && (
              <span className="ml-2 rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                published
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-zinc-500">
          {summary.doneCount}/{summary.itemCount}
        </span>
        <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-800">
          <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
        </span>
        <span className="shrink-0 text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3 py-2">
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category || "_none"} className="mb-2">
              {category && (
                <p className="mb-1 mt-1 text-xs uppercase tracking-wide text-zinc-600">{category}</p>
              )}
              {items.map((item) => (
                <div key={item.id} className="group flex items-center gap-2 py-0.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!item.completedAt}
                      onChange={() =>
                        check.mutate({ itemId: item.id, completed: !item.completedAt })
                      }
                    />
                    <span
                      className={`truncate text-sm ${
                        item.completedAt ? "text-zinc-600 line-through" : "text-zinc-300"
                      }`}
                    >
                      {item.text}
                    </span>
                  </label>
                  <button
                    onClick={() => deleteItem.mutate(item.id)}
                    className="hidden shrink-0 text-xs text-zinc-600 hover:text-red-400 group-hover:block"
                    title="Delete item"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}

          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (newItem.trim()) addItem.mutate();
            }}
            className="mt-1 flex gap-2"
          >
            <input
              value={newItem}
              onChange={(ev) => setNewItem(ev.target.value)}
              placeholder="+ add item"
              className="flex-1 rounded-md border border-dashed border-zinc-700 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
            />
            <input
              value={newCategory}
              onChange={(ev) => setNewCategory(ev.target.value)}
              placeholder="category"
              className="w-28 rounded-md border border-dashed border-zinc-800 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-zinc-700 focus:border-indigo-500"
            />
          </form>

          <div className="mt-3 flex items-center justify-between border-t border-zinc-800/60 pt-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={summary.isPublic}
                onChange={(ev) => publish.mutate(ev.target.checked)}
              />
              Publish for other players
            </label>
            <button
              onClick={() => {
                if (confirm(`Delete checklist "${summary.title}"?`)) removeList.mutate();
              }}
              className="text-xs text-zinc-600 hover:text-red-400"
            >
              Delete checklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
