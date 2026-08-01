import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConsoleSummary } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { AddConsoleControl, FAMILY_LABELS, usePlatforms } from "../components/ConsolePicker.js";
import { ConsoleArtBrowser } from "../components/ConsoleArtBrowser.js";

/** "1996-06-23" → "23 June 1996"; the day matters for launch dates. */
export function formatReleaseDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ConsolesPage() {
  const consoles = useQuery({ queryKey: ["consoles"], queryFn: () => api.getConsoles() });
  const platforms = usePlatforms();

  const rows = consoles.data ?? [];
  // storefront totals are already counted inside their parent platform
  const totalGames = rows
    .filter((c) => !c.platform.parentPlatformId)
    .reduce((sum, c) => sum + c.gameCount, 0);

  const consolesOnly = rows.filter((c) => !c.platform.parentPlatformId);
  const storefrontsByParent = new Map<string, ConsoleSummary[]>();
  for (const row of rows) {
    const parentId = row.platform.parentPlatformId;
    if (!parentId) continue;
    storefrontsByParent.set(parentId, [...(storefrontsByParent.get(parentId) ?? []), row]);
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">
          Consoles{" "}
          <span className="text-sm font-normal text-zinc-500">
            {rows.length} owned · {totalGames} games filed
          </span>
        </h1>
        <AddConsoleControl platforms={platforms.data ?? []} />
      </div>

      {consoles.isLoading && <p className="text-zinc-500">Loading consoles…</p>}

      {!consoles.isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-12 text-center">
          <p className="mb-2 text-lg font-semibold">No consoles yet</p>
          <p className="mb-6 text-sm text-zinc-400">
            Add the consoles and PC storefronts you own — they become the platforms you can
            file games under, and each one gets a page of its own.
          </p>
          <div className="flex justify-center">
            <AddConsoleControl platforms={platforms.data ?? []} label="+ Add your first console" />
          </div>
        </div>
      )}

      {/* one section per console; a platform with storefronts (PC) gets its
          stores as their own sub-section underneath it */}
      <div className="space-y-4">
        {consolesOnly.map((row) => {
          const stores = storefrontsByParent.get(row.platform.id) ?? [];
          return (
            <div key={row.platform.id} className="space-y-3">
              <ConsoleCard row={row} />
              {stores.length > 0 && (
                <div className="ml-0 space-y-3 border-l-2 border-zinc-800 pl-4 sm:ml-6">
                  <p className="text-xs uppercase tracking-wide text-zinc-600">
                    {row.platform.name} storefronts
                  </p>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {stores.map((store) => (
                      <ConsoleCard key={store.platform.id} row={store} compact />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function ConsoleCard({ row, compact = false }: { row: ConsoleSummary; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [browsing, setBrowsing] = useState(false);
  const p = row.platform;
  const released = formatReleaseDate(p.releaseDate);
  // your upload wins over the stock IGDB logo
  const art = row.customImageSrc ?? p.logoUrl;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["consoles"] });
    queryClient.invalidateQueries({ queryKey: ["platforms"] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const remove = useMutation({ mutationFn: () => api.removeConsole(p.id), onSuccess: refresh });
  const uploadImage = useMutation({
    mutationFn: (file: File) => api.uploadConsoleImage(p.id, file, file.name),
    onSuccess: refresh,
  });
  const clearImage = useMutation({
    mutationFn: () => api.removeConsoleImage(p.id),
    onSuccess: refresh,
  });

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className={`flex gap-4 ${compact ? "p-4" : "p-5"}`}>
        <div className="flex-none">
          <div
            className={`flex items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-3 ${
              compact ? "h-16 w-24" : "h-24 w-32"
            }`}
          >
            {art ? (
              <img
                src={art}
                alt={p.name}
                loading="lazy"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-center text-xs font-semibold text-zinc-600">
                {p.abbreviation ?? p.name}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
            <button
              onClick={() => setBrowsing(true)}
              className="text-[11px] text-zinc-600 hover:text-indigo-300"
            >
              Browse art
            </button>
            <label className="cursor-pointer text-[11px] text-zinc-600 hover:text-indigo-300">
              {uploadImage.isPending ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) uploadImage.mutate(file);
                  ev.target.value = "";
                }}
              />
            </label>
            {row.customImageSrc && (
              <button
                onClick={() => clearImage.mutate()}
                title="Back to the stock logo"
                className="text-[11px] text-zinc-600 hover:text-red-400"
              >
                reset
              </button>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className={`mr-auto font-semibold ${compact ? "text-base" : "text-lg"}`}>
              <Link
                to="/console/$platformId"
                params={{ platformId: p.id }}
                className="hover:text-indigo-300"
              >
                {p.name}
              </Link>
            </h2>
            <button
              onClick={() => {
                const msg =
                  row.gameCount > 0
                    ? `Remove ${p.name}? Its ${row.gameCount} game(s) stay in your library but lose this platform.`
                    : `Remove ${p.name} from your consoles?`;
                if (confirm(msg)) remove.mutate();
              }}
              title="Remove this console"
              className="px-1 text-xs text-zinc-600 hover:text-red-400"
            >
              ✕
            </button>
          </div>
          <p className="text-xs uppercase tracking-wide text-zinc-600">
            {p.parentName ? `${p.parentName} storefront` : FAMILY_LABELS[p.family]}
            {released && ` · ${p.parentName ? "launched" : "released"} ${released}`}
          </p>
          {p.summary && (
            <p
              className={`mt-2 text-sm leading-relaxed text-zinc-400 ${
                compact ? "line-clamp-2" : "line-clamp-3"
              }`}
            >
              {p.summary}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto border-t border-zinc-800 px-5 py-4">
        <div className="mb-3 flex items-center gap-3 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-300">
            {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
          </span>
          {row.storefrontCount > 0 && <span>🛒 {row.storefrontCount} via storefronts</span>}
          {row.physicalCount > 0 && <span>📦 {row.physicalCount} physical</span>}
          {row.digitalCount > 0 && <span>💾 {row.digitalCount} digital</span>}
          {row.gameCount > row.preview.length && (
            <Link
              to="/console/$platformId"
              params={{ platformId: p.id }}
              className="ml-auto text-indigo-400 hover:text-indigo-300"
            >
              See all →
            </Link>
          )}
        </div>
        {row.gameCount === 0 ? (
          <p className="text-sm text-zinc-600">
            Nothing filed under this console yet.{" "}
            <Link to="/add" className="text-indigo-400 hover:text-indigo-300">
              Add a game
            </Link>
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {row.preview.map((game) => (
              <Link
                key={game.entryId}
                to="/game/$id"
                params={{ id: game.entryId }}
                title={game.title}
                className="h-24 w-16 flex-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 transition hover:border-zinc-500"
              >
                {game.coverSrc ? (
                  <img
                    src={game.coverSrc}
                    alt={game.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center p-1 text-center text-[10px] font-semibold text-zinc-500">
                    {game.title}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {browsing && (
        <ConsoleArtBrowser
          platformId={p.id}
          platformName={p.name}
          onClose={() => setBrowsing(false)}
        />
      )}
    </section>
  );
}
