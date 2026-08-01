import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { OwnershipFormat } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { GameCard } from "../components/GameCard.js";
import { FAMILY_LABELS, usePlatforms } from "../components/ConsolePicker.js";
import { formatReleaseDate } from "./Consoles.js";

type FormatFilter = "all" | OwnershipFormat;

const FORMAT_FILTERS: Array<{ key: FormatFilter; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "physical", label: "📦 Physical" },
  { key: "digital", label: "💾 Digital" },
];

export function ConsoleDetailPage() {
  const { platformId } = useParams({ from: "/console/$platformId" });
  const platforms = usePlatforms();
  const library = useQuery({ queryKey: ["library"], queryFn: () => api.getLibrary() });
  const [format, setFormat] = useState<FormatFilter>("all");

  const platform = platforms.data?.find((p) => p.id === platformId);
  const consoles = useQuery({ queryKey: ["consoles"], queryFn: () => api.getConsoles() });
  const art =
    consoles.data?.find((c) => c.platform.id === platformId)?.customImageSrc ??
    platform?.logoUrl ??
    null;

  // a platform's page includes anything filed under its storefronts — the
  // PC page is your whole PC library, Steam's page is just the Steam part
  const entries = useMemo(
    () =>
      (library.data ?? []).filter((e) =>
        e.platforms.some(
          (p) =>
            (p.platformId === platformId || p.parentPlatformId === platformId) &&
            (format === "all" || p.format === format),
        ),
      ),
    [library.data, platformId, format],
  );

  if (platforms.data && !platform) {
    return (
      <Shell>
        <p className="text-red-400">Console not found.</p>
      </Shell>
    );
  }

  const released = formatReleaseDate(platform?.releaseDate ?? null);

  return (
    <Shell>
      <Link to="/consoles" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← All consoles
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap gap-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex h-28 w-40 flex-none items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          {art ? (
            <img
              src={art}
              alt={platform?.name ?? "Console"}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-center text-sm font-semibold text-zinc-600">
              {platform?.abbreviation ?? platform?.name ?? "—"}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{platform?.name ?? "Console"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {platform?.parentName
              ? `${platform.parentName} storefront`
              : platform && FAMILY_LABELS[platform.family]}
            {released && ` · released ${released}`}
            {!platform?.owned && " · not on your consoles list"}
          </p>
          {platform?.summary && (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
              {platform.summary}
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">
          Your library here{" "}
          <span className="text-sm font-normal text-zinc-500">
            {entries.length} {entries.length === 1 ? "game" : "games"}
          </span>
        </h2>
        {FORMAT_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFormat(f.key)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              format === f.key
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {library.isLoading && <p className="text-zinc-500">Loading…</p>}

      {!library.isLoading && entries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-700 p-10 text-center">
          <p className="mb-2 font-semibold">Nothing filed under this console yet</p>
          <p className="mb-5 text-sm text-zinc-400">
            Pick it on a game's page, or set it as the platform in quick add.
          </p>
          <Link
            to="/add"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
          >
            Add a game
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {entries.map((entry) => (
          <GameCard key={entry.id} entry={entry} />
        ))}
      </div>
    </Shell>
  );
}
