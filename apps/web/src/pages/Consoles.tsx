import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConsoleSummary } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { AddConsoleControl, FAMILY_LABELS, usePlatforms } from "../components/ConsolePicker.js";

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
  const totalGames = rows.reduce((sum, c) => sum + c.gameCount, 0);

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

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => (
          <ConsoleCard key={row.platform.id} row={row} />
        ))}
      </div>
    </Shell>
  );
}

function ConsoleCard({ row }: { row: ConsoleSummary }) {
  const queryClient = useQueryClient();
  const p = row.platform;
  const released = formatReleaseDate(p.releaseDate);

  const remove = useMutation({
    mutationFn: () => api.removeConsole(p.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      queryClient.invalidateQueries({ queryKey: ["platforms"] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className="flex gap-4 p-5">
        <div className="flex h-24 w-32 flex-none items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-3">
          {p.logoUrl ? (
            <img
              src={p.logoUrl}
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
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className="mr-auto text-lg font-semibold">
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
            {FAMILY_LABELS[p.family]}
            {released && ` · released ${released}`}
          </p>
          {p.summary && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-zinc-400">{p.summary}</p>
          )}
        </div>
      </div>

      <div className="mt-auto border-t border-zinc-800 px-5 py-4">
        <div className="mb-3 flex items-center gap-3 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-300">
            {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
          </span>
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
    </section>
  );
}
