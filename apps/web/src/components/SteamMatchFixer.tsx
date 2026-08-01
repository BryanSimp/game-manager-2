import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LibraryEntry } from "@gm/shared";
import { api } from "../lib/api.js";

/**
 * Fixing a Steam import that matched the wrong game.
 *
 * Title matching can't separate two games called the same thing, and a wrong
 * match comes back on every import — so the fix has to be a standing rule,
 * not a one-off edit. Either block the app for good, or pin it to the game
 * you actually own, which also swaps this entry for the right one and keeps
 * the playtime.
 */
export function SteamMatchFixer({ entry }: { entry: LibraryEntry }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const appId = entry.game.steamAppId;

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const search = useQuery({
    queryKey: ["game-search", query, null],
    queryFn: () => api.searchGames(query),
    enabled: open && query.length >= 2,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["steam-rules"] });
  };

  const block = useMutation({
    mutationFn: () =>
      api.saveSteamRule({
        steamAppId: appId!,
        action: "block",
        appName: entry.game.title,
      }),
    onSuccess: refresh,
  });

  const pin = useMutation({
    mutationFn: (target: { igdbId?: number; gameId?: string; title: string }) =>
      api.saveSteamRule({
        steamAppId: appId!,
        action: "map",
        igdbId: target.igdbId,
        gameId: target.gameId,
        appName: target.title,
        // swap this mis-matched entry for the right game
        replaceEntryId: entry.id,
      }),
    onSuccess: (res) => {
      refresh();
      if (res.replacedWithEntryId) {
        navigate({ to: "/game/$id", params: { id: res.replacedWithEntryId } });
      } else {
        navigate({ to: "/" });
      }
    },
  });

  if (!appId) return null;

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-zinc-400">
          Imported from Steam · app{" "}
          <span className="font-mono text-zinc-300">{appId}</span>
          {block.isSuccess && (
            <span className="ml-2 text-emerald-400">Blocked from future imports.</span>
          )}
        </p>
        {!block.isSuccess && (
          <>
            <button
              onClick={() => setOpen(!open)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              {open ? "Cancel" : "Wrong game?"}
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="text-xs text-zinc-500">
            Steam calls this app "{entry.game.title}" here. Pick the game it really is — the
            importer will use your answer every time — or stop importing this app entirely.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={input}
              onChange={(ev) => setInput(ev.target.value)}
              placeholder="Search for the right game…"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => {
                if (
                  confirm(
                    `Never import Steam app ${appId} again? "${entry.game.title}" stays in your library until you remove it.`,
                  )
                ) {
                  block.mutate();
                }
              }}
              disabled={block.isPending}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
            >
              ⛔ Never import this app
            </button>
          </div>

          {pin.isPending && <p className="mt-2 text-xs text-indigo-300">Saving…</p>}
          {pin.isError && (
            <p className="mt-2 text-xs text-red-400">{String(pin.error.message)}</p>
          )}
          {search.isLoading && <p className="mt-2 text-xs text-zinc-500">Searching…</p>}

          <div className="mt-3 grid gap-2">
            {(search.data?.results ?? []).slice(0, 6).map((result) => (
              <button
                key={`${result.igdbId ?? result.gameId}`}
                disabled={pin.isPending}
                onClick={() =>
                  pin.mutate({
                    igdbId: result.igdbId ?? undefined,
                    gameId: result.gameId ?? undefined,
                    title: result.title,
                  })
                }
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-indigo-500 disabled:opacity-50"
              >
                <span className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
                  {result.coverSrc && (
                    <img
                      src={result.coverSrc}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {result.title}{" "}
                  {result.releaseYear && (
                    <span className="text-zinc-500">({result.releaseYear})</span>
                  )}
                </span>
                <span className="flex-none text-xs text-indigo-300">Use this →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
