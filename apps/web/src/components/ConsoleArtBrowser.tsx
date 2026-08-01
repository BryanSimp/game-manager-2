import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Pick console art from IGDB's platform logos and Wikimedia Commons, rather
 * than going and finding a file yourself. Same shape as the cover browser:
 * the server downloads whatever you pick, from an allowlisted host.
 */
export function ConsoleArtBrowser({
  platformId,
  platformName,
  onClose,
}: {
  platformId: string;
  platformName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const art = useQuery({
    queryKey: ["console-art", platformId],
    queryFn: () => api.getConsoleArt(platformId),
  });

  const choose = useMutation({
    mutationFn: (url: string) => api.setConsoleImageFromUrl(platformId, url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consoles"] });
      onClose();
    },
  });

  const images = art.data?.images ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">Art for {platformName}</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ✕ Close
          </button>
        </div>

        {art.isLoading && <p className="text-zinc-500">Looking for logos…</p>}
        {choose.isPending && <p className="mb-3 text-sm text-indigo-300">Saving…</p>}
        {choose.isError && (
          <p className="mb-3 text-sm text-red-400">{String(choose.error.message)}</p>
        )}

        {!art.isLoading && images.length === 0 && (
          <p className="text-sm text-zinc-400">
            Nothing found for this one — upload your own image instead.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image) => (
            <button
              key={image.id}
              disabled={choose.isPending}
              onClick={() => choose.mutate(image.url)}
              title={image.label ?? undefined}
              className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 transition hover:border-indigo-500 disabled:opacity-50"
            >
              <span className="flex h-24 items-center justify-center p-3">
                <img
                  src={image.thumbUrl}
                  alt={image.label ?? platformName}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              </span>
              <span className="truncate border-t border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 group-hover:text-zinc-300">
                {image.label ?? (image.source === "igdb" ? "IGDB" : "Commons")}
              </span>
            </button>
          ))}
        </div>

        {images.length > 0 && (
          <p className="mt-4 text-xs text-zinc-600">
            Logos from IGDB and Wikimedia Commons. Commons results are a text search, so the
            odd unrelated file turns up.
          </p>
        )}
      </div>
    </div>
  );
}
