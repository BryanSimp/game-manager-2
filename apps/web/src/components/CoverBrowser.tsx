import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Pick an alternate cover from SteamGridDB. Opens over the page rather than
 * navigating, so you can compare against the current art behind it.
 *
 * The server does the downloading — the browser never fetches from the image
 * host directly, so the picked file ends up on the volume like any other
 * custom cover.
 */
export function CoverBrowser({
  entryId,
  title,
  onClose,
}: {
  entryId: string;
  title: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const options = useQuery({
    queryKey: ["cover-options", entryId],
    queryFn: () => api.getCoverOptions(entryId),
  });

  const pick = useMutation({
    mutationFn: (url: string) => api.setCoverFromUrl(entryId, url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", entryId] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
  });

  const data = options.data;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">Covers for {title}</p>
            <p className="text-xs text-zinc-500">
              Community artwork from SteamGridDB · click one to use it
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ✕ Close
          </button>
        </div>

        {options.isLoading && <p className="py-8 text-center text-sm text-zinc-500">Searching…</p>}

        {data && !data.configured && (
          <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
            SteamGridDB isn't set up yet. An admin can paste a free API key into Settings to turn
            this on.
          </p>
        )}

        {data?.configured && data.covers.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">
            No alternate covers found for this game.
          </p>
        )}

        {pick.isError && (
          <p className="mb-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {(pick.error as Error).message}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {(data?.covers ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => pick.mutate(c.url)}
              disabled={pick.isPending}
              title={[c.style, c.author && `by ${c.author}`, `${c.width}×${c.height}`]
                .filter(Boolean)
                .join(" · ")}
              className="group overflow-hidden rounded-lg border border-zinc-800 transition hover:border-indigo-500 disabled:opacity-50"
            >
              <img
                src={c.thumbUrl}
                alt=""
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition group-hover:brightness-110"
              />
            </button>
          ))}
        </div>

        {pick.isPending && (
          <p className="mt-3 text-center text-sm text-indigo-300">Saving cover…</p>
        )}
      </div>
    </div>
  );
}
