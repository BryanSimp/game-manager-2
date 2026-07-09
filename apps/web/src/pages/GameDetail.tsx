import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GAME_STATUSES,
  PLATFORM_FAMILIES,
  type GameStatus,
  type OwnershipFormat,
  type UpdateEntryInput,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { StarRating } from "../components/StarRating.js";
import { STATUS_META, formatHours } from "../lib/format.js";

const FAMILY_LABELS: Record<string, string> = {
  nintendo: "Nintendo",
  sony: "PlayStation",
  xbox: "Xbox",
  pc: "PC",
  sega: "Sega",
  other: "Other",
};

export function GameDetailPage() {
  const { id } = useParams({ from: "/game/$id" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const entry = useQuery({ queryKey: ["entry", id], queryFn: () => api.getEntry(id) });
  const platforms = useQuery({ queryKey: ["platforms"], queryFn: () => api.getPlatforms() });

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  useEffect(() => {
    if (entry.data && !notesDirty) setNotes(entry.data.notes ?? "");
  }, [entry.data, notesDirty]);

  const update = useMutation({
    mutationFn: (input: UpdateEntryInput) => api.updateEntry(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", id] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const setPlatforms = useMutation({
    mutationFn: (owned: Array<{ platformId: string; format: OwnershipFormat }>) =>
      api.setEntryPlatforms(id, owned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", id] });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removeEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library"] });
      navigate({ to: "/" });
    },
  });

  if (entry.isLoading) {
    return (
      <Shell>
        <p className="text-zinc-500">Loading…</p>
      </Shell>
    );
  }
  if (!entry.data) {
    return (
      <Shell>
        <p className="text-red-400">Game not found.</p>
      </Shell>
    );
  }

  const e = entry.data;
  const owned = new Map(e.platforms.map((p) => [p.platformId, p.format]));

  function togglePlatform(platformId: string) {
    const next = new Map(owned);
    if (next.has(platformId)) next.delete(platformId);
    else next.set(platformId, "digital");
    setPlatforms.mutate([...next].map(([pid, format]) => ({ platformId: pid, format })));
  }

  function toggleFormat(platformId: string) {
    const next = new Map(owned);
    next.set(platformId, next.get(platformId) === "digital" ? "physical" : "digital");
    setPlatforms.mutate([...next].map(([pid, format]) => ({ platformId: pid, format })));
  }

  return (
    <Shell>
      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        <div>
          <div className="aspect-[3/4] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800">
            {e.game.coverSrc ? (
              <img src={e.game.coverSrc} alt={e.game.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center font-semibold text-zinc-500">
                {e.game.title}
              </div>
            )}
          </div>
          {(e.game.ttbMain || e.game.ttbCompletionist) && (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
              <p className="mb-2 font-semibold text-zinc-300">How long to beat</p>
              <Ttb label="Main story" value={formatHours(e.game.ttbMain)} />
              <Ttb label="Main + extras" value={formatHours(e.game.ttbMainExtra)} />
              <Ttb label="Completionist" value={formatHours(e.game.ttbCompletionist)} />
              <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={!e.ttbEnabled}
                  onChange={() => update.mutate({ ttbEnabled: !e.ttbEnabled })}
                />
                Endless game (exclude from backlog time)
              </label>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{e.game.title}</h1>
          {e.game.releaseDate && (
            <p className="mt-1 text-sm text-zinc-500">Released {e.game.releaseDate}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {GAME_STATUSES.map((s: GameStatus) => (
              <button
                key={s}
                onClick={() => update.mutate({ status: s })}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  e.status === s
                    ? STATUS_META[s].classes
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                }`}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <p className="mb-1 text-sm font-semibold text-zinc-300">Your rating</p>
            <StarRating value={e.rating} onChange={(v) => update.mutate({ rating: v })} />
          </div>

          {e.game.summary && (
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400">{e.game.summary}</p>
          )}

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold text-zinc-300">
              Owned on{" "}
              <span className="font-normal text-zinc-500">
                (click to toggle · badge switches physical/digital)
              </span>
            </p>
            <div className="space-y-3">
              {PLATFORM_FAMILIES.map((family) => {
                const fams = (platforms.data ?? []).filter((p) => p.family === family);
                if (fams.length === 0) return null;
                return (
                  <div key={family}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-zinc-600">
                      {FAMILY_LABELS[family]}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {fams.map((p) => {
                        const format = owned.get(p.id);
                        return (
                          <span key={p.id} className="inline-flex overflow-hidden rounded-lg border border-zinc-700">
                            <button
                              onClick={() => togglePlatform(p.id)}
                              className={`px-3 py-1 text-sm ${
                                format
                                  ? "bg-indigo-600/30 text-indigo-200"
                                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                              }`}
                            >
                              {p.abbreviation ?? p.name}
                            </button>
                            {format && (
                              <button
                                onClick={() => toggleFormat(p.id)}
                                title="Toggle physical/digital"
                                className="border-l border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                              >
                                {format === "physical" ? "📦" : "💾"}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 max-w-2xl">
            <p className="mb-1 text-sm font-semibold text-zinc-300">Notes</p>
            <textarea
              value={notes}
              onChange={(ev) => {
                setNotes(ev.target.value);
                setNotesDirty(true);
              }}
              rows={4}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              placeholder="Your notes…"
            />
            {notesDirty && (
              <button
                onClick={() => {
                  update.mutate({ notes });
                  setNotesDirty(false);
                }}
                className="mt-2 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold hover:bg-indigo-500"
              >
                Save notes
              </button>
            )}
          </div>

          <div className="mt-10 border-t border-zinc-800 pt-4">
            <button
              onClick={() => {
                if (confirm(`Remove "${e.game.title}" from your library?`)) remove.mutate();
              }}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              Remove from library
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Ttb({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-0.5 text-zinc-400">
      <span>{label}</span>
      <span className="font-medium text-zinc-200">{value}</span>
    </div>
  );
}
