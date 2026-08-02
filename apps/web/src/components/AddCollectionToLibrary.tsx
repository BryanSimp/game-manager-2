import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OwnershipFormat } from "@gm/shared";
import { api } from "../lib/api.js";
import { ConsoleSelect } from "./ConsolePicker.js";
import { useCategories } from "../lib/categories.js";

/**
 * "Add all N games to my library" for a collection you're browsing — the
 * reason to look at someone else's in the first place.
 *
 * You pick the category and (optionally) the platform up front, because
 * dropping twelve games into Uncategorized on no console is worse than not
 * having the button. Games you already own are reported as skipped rather
 * than silently re-filed.
 */
export function AddCollectionToLibrary({
  collectionId,
  total,
  label = "Add all to library",
}: {
  collectionId: string;
  total: number;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("wishlist");
  const [platformId, setPlatformId] = useState<string | null>(null);
  const [format, setFormat] = useState<OwnershipFormat>("digital");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const add = useMutation({
    mutationFn: () =>
      api.addCollectionToLibrary(collectionId, {
        status,
        platforms: platformId ? [{ platformId, format }] : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-collections"] });
    },
  });

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={total === 0}
        className="rounded-lg border border-emerald-600/50 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/15 disabled:opacity-40"
      >
        {label}
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <p className="mb-2 text-xs text-zinc-400">
            Adds all {total} {total === 1 ? "game" : "games"}. Ones you already own are left as they
            are.
          </p>

          <label className="block text-xs font-semibold text-zinc-400">Category</label>
          <select
            value={status}
            onChange={(ev) => setStatus(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
          >
            {(categories ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-semibold text-zinc-400">
            Platform <span className="font-normal text-zinc-600">(optional)</span>
          </label>
          <div className="mt-1">
            <ConsoleSelect value={platformId} onChange={setPlatformId} />
          </div>
          {platformId && (
            <div className="mt-2 flex gap-2">
              {(["digital", "physical"] as OwnershipFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 rounded-lg border px-2 py-1 text-xs capitalize ${
                    format === f
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                      : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {f === "digital" ? "💾 Digital" : "📦 Physical"}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {add.isPending ? "Adding…" : `Add ${total} to library`}
          </button>

          {add.isSuccess && (
            <p className="mt-2 text-xs text-emerald-400">
              {add.data.added} added
              {add.data.skipped > 0 && ` · ${add.data.skipped} already yours`}
              {add.data.errors.length > 0 && ` · ${add.data.errors.length} failed`}
            </p>
          )}
          {add.isError && (
            <p className="mt-2 text-xs text-red-400">
              {add.error instanceof Error ? add.error.message : "Couldn't add those games"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
