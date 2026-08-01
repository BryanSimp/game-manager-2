import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLATFORM_FAMILIES, type Platform } from "@gm/shared";
import { api } from "../lib/api.js";

export const FAMILY_LABELS: Record<string, string> = {
  nintendo: "Nintendo",
  sony: "PlayStation",
  xbox: "Xbox",
  pc: "PC",
  sega: "Sega",
  other: "Other",
};

/** All platforms, each flagged with whether it's on your consoles list. */
export function usePlatforms() {
  return useQuery({ queryKey: ["platforms"], queryFn: () => api.getPlatforms() });
}

/** "Steam" reads better as "PC · Steam" anywhere the parent isn't obvious. */
export function platformLabel(platform: Platform): string {
  return platform.parentName ? `${platform.parentName} · ${platform.name}` : platform.name;
}

/**
 * Adds a console to your list. Everything that can file a game under a
 * platform offers this, so you're never stuck because you haven't set the
 * console up first — the answer to "I own Pokémon Emerald but no GBA yet" is
 * one dropdown away, not a trip to another page.
 */
export function AddConsoleControl({
  platforms,
  onAdded,
  label = "+ Add new console",
}: {
  platforms: Platform[];
  /** called with the new console once it's on the list */
  onAdded?: (platform: Platform) => void;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const add = useMutation({
    mutationFn: (platformId: string) => api.addConsole(platformId),
    onSuccess: (_data, platformId) => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      const platform = platforms.find((p) => p.id === platformId);
      if (platform) onAdded?.(platform);
    },
  });

  const unowned = platforms.filter((p) => !p.owned);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={unowned.length === 0}
        className="rounded-lg border border-dashed border-zinc-600 px-3 py-1 text-sm text-zinc-400 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40"
      >
        {unowned.length === 0 ? "All consoles added" : label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        autoFocus
        defaultValue=""
        disabled={add.isPending}
        onChange={(ev) => {
          if (ev.target.value) add.mutate(ev.target.value);
        }}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-indigo-500"
      >
        <option value="" disabled>
          Choose a console…
        </option>
        {PLATFORM_FAMILIES.map((family) => {
          const inFamily = unowned.filter((p) => p.family === family);
          if (inFamily.length === 0) return null;
          return (
            <optgroup key={family} label={FAMILY_LABELS[family]}>
              {inFamily.map((p) => (
                // storefronts are indented under whatever they sell for
                <option key={p.id} value={p.id}>
                  {p.parentName ? `↳ ${p.name}` : p.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        Cancel
      </button>
    </span>
  );
}

/**
 * Pick one console out of the ones you own, with an escape hatch to add one
 * you don't. Used by quick add, import, preferences and the library's bulk
 * platform edit; the game detail page has its own multi-select variant.
 *
 * Two levels: picking a platform that has storefronts (PC) reveals a second
 * dropdown for which store the copy lives in. The value handed back is the
 * storefront's id when one is chosen and the platform's when it isn't —
 * either way the game counts as a PC game, because Steam *is* PC here.
 */
export function ConsoleSelect({
  value,
  onChange,
  placeholder = "No platform",
  allowNone = true,
}: {
  value: string | null;
  onChange: (platformId: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const platforms = usePlatforms();
  const all = platforms.data ?? [];
  // the top-level select only ever shows platforms, never their stores
  const owned = all.filter((p) => p.owned && !p.parentPlatformId);

  const selected = all.find((p) => p.id === value) ?? null;
  const parentId = selected?.parentPlatformId ?? selected?.id ?? "";
  const stores = all.filter((p) => p.parentPlatformId === parentId);
  const ownedStores = stores.filter((s) => s.owned);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        value={parentId}
        onChange={(ev) => onChange(ev.target.value || null)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
      >
        {allowNone && <option value="">{placeholder}</option>}
        {owned.length === 0 && !allowNone && <option value="">No consoles yet</option>}
        {owned.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {stores.length > 0 && (
        <select
          value={selected?.parentPlatformId ? selected.id : ""}
          onChange={(ev) => onChange(ev.target.value || parentId)}
          title="Which storefront this copy lives in"
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        >
          <option value="">No storefront</option>
          {ownedStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <AddConsoleControl
        platforms={all}
        onAdded={(p) => onChange(p.id)}
        label={stores.length > 0 ? "+ New console or store" : "+ New console"}
      />
    </span>
  );
}
