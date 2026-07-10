import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BulkAddResult, ImportCandidate, ImportItem } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

interface ReviewItem {
  id: string;
  raw: string;
  cleaned: string;
  candidates: ImportCandidate[];
  selected: ImportCandidate | null; // null = add manually by title
  confidence: number | null;
  skipped: boolean;
}

type Stage = "input" | "processing" | "review" | "done";

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued…",
  ocr: "Reading the image…",
  matching: "Matching titles against the game database…",
};

export function ImportPage() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>("input");
  const [jobId, setJobId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkAddResult | null>(null);

  // poll the job while the pipeline runs
  const job = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => api.getImport(jobId!),
    enabled: !!jobId && stage === "processing",
    refetchInterval: 1500,
  });

  useEffect(() => {
    if (stage !== "processing" || !job.data) return;
    if (job.data.status === "failed") {
      setError(job.data.error ?? "Import failed");
      setStage("input");
      setJobId(null);
    } else if (job.data.status === "review") {
      setItems(
        job.data.items.map((it: ImportItem) => ({
          id: it.id,
          raw: it.rawText,
          cleaned: it.cleanedTitle,
          candidates: it.candidates,
          selected: it.candidates[0] ?? null,
          confidence: it.confidence,
          skipped: false,
        })),
      );
      setStage("review");
    }
  }, [job.data, stage]);

  const startImage = useMutation({
    mutationFn: ({ file, source }: { file: File; source: "screenshot" | "shelf_photo" }) =>
      api.createImageImport(file, file.name, source),
    onSuccess: (created) => {
      setError(null);
      setJobId(created.id);
      setStage("processing");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Upload failed"),
  });

  const startText = useMutation({
    mutationFn: () => api.createTextImport(text),
    onSuccess: (created) => {
      setError(null);
      setJobId(created.id);
      setStage("processing");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Import failed"),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const res = await api.bulkAdd(
        items
          .filter((it) => !it.skipped)
          .map((it) =>
            it.selected?.igdbId
              ? { igdbId: it.selected.igdbId }
              : { title: it.selected?.title ?? it.cleaned },
          ),
      );
      if (jobId) await api.finishImport(jobId);
      return res;
    },
    onSuccess: (res) => {
      setResult(res);
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  function setItem(id: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function research(item: ReviewItem) {
    const query = window.prompt("Search for a different match:", item.cleaned);
    if (!query?.trim()) return;
    const res = await api.searchGames(query.trim());
    const candidates: ImportCandidate[] = res.results.slice(0, 6).map((r) => ({
      igdbId: r.igdbId,
      gameId: r.gameId,
      title: r.title,
      releaseYear: r.releaseYear,
      coverSrc: r.coverSrc,
    }));
    setItem(item.id, { candidates, selected: candidates[0] ?? null, confidence: null });
  }

  function reset() {
    setStage("input");
    setJobId(null);
    setText("");
    setItems([]);
    setResult(null);
    setError(null);
  }

  const active = items.filter((it) => !it.skipped);

  return (
    <Shell>
      <h1 className="mb-1 text-xl font-bold">Import games</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Upload a screenshot of a game library, a photo of your physical shelf, or paste a list of
        titles. Everything gets matched automatically — you review before anything is added.
      </p>

      {error && (
        <p className="mb-4 max-w-2xl rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {stage === "input" && (
        <div className="grid max-w-4xl gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="font-semibold">📸 Screenshot or shelf photo</h2>
            <p className="mt-1 mb-4 text-sm text-zinc-400">
              A screenshot of Steam/your launcher, or a photo of game boxes on a shelf.
            </p>
            <div className="flex flex-col gap-2">
              <UploadButton
                label={startImage.isPending ? "Uploading…" : "Upload library screenshot"}
                disabled={startImage.isPending}
                onFile={(file) => startImage.mutate({ file, source: "screenshot" })}
              />
              <UploadButton
                label={startImage.isPending ? "Uploading…" : "Upload shelf photo"}
                secondary
                disabled={startImage.isPending}
                onFile={(file) => startImage.mutate({ file, source: "shelf_photo" })}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="font-semibold">📝 Paste a list</h2>
            <p className="mt-1 mb-4 text-sm text-zinc-400">One title per line, up to 200.</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={"The Legend of Zelda: Breath of the Wild\nHades\nHollow Knight"}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => startText.mutate()}
                disabled={!text.trim() || startText.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                Match titles
              </button>
              <label className="cursor-pointer rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Load .txt
                <input
                  type="file"
                  accept=".txt"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setText(await file.text());
                  }}
                />
              </label>
            </div>
          </section>
        </div>
      )}

      {stage === "processing" && (
        <div className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
          <p className="font-semibold">{STATUS_LABELS[job.data?.status ?? "pending"]}</p>
          <p className="mt-2 text-sm text-zinc-500">
            {job.data?.source === "shelf_photo"
              ? "Reading spines from a photo can take a minute."
              : "This usually takes a few seconds."}
          </p>
        </div>
      )}

      {stage === "review" && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <p className="mr-auto text-sm text-zinc-400">
              {active.length} of {items.length} titles will be added — fix any wrong matches first
            </p>
            <button
              onClick={reset}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Start over
            </button>
            <button
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending || active.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {confirm.isPending ? "Adding…" : `Add ${active.length} games`}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800">
            {items.map((it) => (
              <div
                key={it.id}
                className={`flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2 last:border-0 ${
                  it.skipped ? "opacity-40" : ""
                }`}
              >
                <ConfidenceDot confidence={it.confidence} hasMatch={!!it.selected} />
                <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
                  {it.selected?.coverSrc && (
                    <img src={it.selected.coverSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-zinc-500" title="What was read from the image">
                    {it.raw}
                  </p>
                  {it.candidates.length > 0 ? (
                    <select
                      value={it.selected ? String(it.selected.igdbId ?? it.selected.gameId) : "manual"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setItem(it.id, {
                          selected:
                            v === "manual"
                              ? null
                              : (it.candidates.find((c) => String(c.igdbId ?? c.gameId) === v) ?? null),
                        });
                      }}
                      className="mt-0.5 w-full max-w-md rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm"
                    >
                      {it.candidates.map((c) => (
                        <option key={String(c.igdbId ?? c.gameId)} value={String(c.igdbId ?? c.gameId)}>
                          {c.title} {c.releaseYear ? `(${c.releaseYear})` : ""}
                        </option>
                      ))}
                      <option value="manual">➕ Add "{it.cleaned}" manually</option>
                    </select>
                  ) : (
                    <p className="text-sm text-amber-400">
                      No match — will be added manually as "{it.cleaned}"
                    </p>
                  )}
                </div>
                <button
                  onClick={() => research(it)}
                  title="Search for a different game"
                  className="flex-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  🔍
                </button>
                <button
                  onClick={() => setItem(it.id, { skipped: !it.skipped })}
                  className="flex-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  {it.skipped ? "Include" : "Skip"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="max-w-xl rounded-xl border border-emerald-900 bg-emerald-950/40 p-6">
          <p className="text-lg font-semibold text-emerald-300">Import complete 🎉</p>
          <p className="mt-2 text-sm text-zinc-300">
            {result.added} added · {result.skipped} already in your library
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-amber-400">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
          <button
            onClick={reset}
            className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Import more
          </button>
        </div>
      )}
    </Shell>
  );
}

function UploadButton({
  label,
  onFile,
  disabled,
  secondary,
}: {
  label: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <label
      className={`cursor-pointer rounded-lg px-4 py-2 text-center text-sm font-semibold ${
        secondary
          ? "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          : "bg-indigo-600 text-white hover:bg-indigo-500"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {label}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function ConfidenceDot({ confidence, hasMatch }: { confidence: number | null; hasMatch: boolean }) {
  let color = "bg-zinc-600";
  let title = "Manually re-matched";
  if (!hasMatch) {
    color = "bg-amber-400";
    title = "No match found";
  } else if (confidence != null) {
    if (confidence >= 0.8) {
      color = "bg-emerald-400";
      title = `Confident match (${Math.round(confidence * 100)}%)`;
    } else if (confidence >= 0.55) {
      color = "bg-amber-400";
      title = `Possible match (${Math.round(confidence * 100)}%) — double-check`;
    } else {
      color = "bg-red-400";
      title = `Weak match (${Math.round(confidence * 100)}%) — probably wrong`;
    }
  }
  return <span className={`h-2.5 w-2.5 flex-none rounded-full ${color}`} title={title} />;
}
