import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BulkAddResult, SearchResult } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { cleanTitle } from "../lib/format.js";

interface ImportItem {
  raw: string;
  cleaned: string;
  match: SearchResult | null;
  candidates: SearchResult[];
  skipped: boolean;
}

type Stage = "input" | "matching" | "review" | "done";

export function ImportPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>("input");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [igdbActive, setIgdbActive] = useState(true);
  const [result, setResult] = useState<BulkAddResult | null>(null);
  const cancelRef = useRef(false);

  async function startMatching() {
    const titles = [...new Set(text.split("\n").map(cleanTitle).filter(Boolean))].slice(0, 200);
    if (titles.length === 0) return;
    cancelRef.current = false;
    setStage("matching");
    setProgress(0);

    const matched: ImportItem[] = [];
    for (const [i, title] of titles.entries()) {
      if (cancelRef.current) break;
      try {
        const res = await api.searchGames(title);
        setIgdbActive(res.igdb);
        matched.push({
          raw: title,
          cleaned: title,
          match: res.results[0] ?? null,
          candidates: res.results.slice(0, 5),
          skipped: false,
        });
      } catch {
        matched.push({ raw: title, cleaned: title, match: null, candidates: [], skipped: false });
      }
      setProgress(i + 1);
      setItems([...matched]);
    }
    setStage("review");
  }

  const confirm = useMutation({
    mutationFn: () =>
      api.bulkAdd(
        items
          .filter((it) => !it.skipped)
          .map((it) =>
            it.match?.igdbId
              ? { igdbId: it.match.igdbId }
              : { title: it.match?.title ?? it.cleaned },
          ),
      ),
    onSuccess: (res) => {
      setResult(res);
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  function setItem(index: number, patch: Partial<ImportItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const active = items.filter((it) => !it.skipped);

  return (
    <Shell>
      <h1 className="mb-1 text-xl font-bold">Import a list</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Paste game titles (one per line) or load a .txt file — screenshots and shelf photos come in a
        later phase.
      </p>

      {stage === "input" && (
        <div className="max-w-2xl">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={"The Legend of Zelda: Breath of the Wild\nHades\nHollow Knight"}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm outline-none focus:border-indigo-500"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={startMatching}
              disabled={!text.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              Match titles
            </button>
            <label className="cursor-pointer rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              Load .txt file
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
            <span className="text-xs text-zinc-500">max 200 titles per import</span>
          </div>
        </div>
      )}

      {stage === "matching" && (
        <div className="max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="mb-3 font-semibold">
            Matching {progress} / {text.split("\n").map(cleanTitle).filter(Boolean).length} titles…
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{
                width: `${(progress / Math.max(1, [...new Set(text.split("\n").map(cleanTitle).filter(Boolean))].length)) * 100}%`,
              }}
            />
          </div>
          <button
            onClick={() => {
              cancelRef.current = true;
            }}
            className="mt-4 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Stop here and review what's matched
          </button>
        </div>
      )}

      {stage === "review" && (
        <div>
          {!igdbActive && (
            <p className="mb-4 max-w-2xl rounded-lg border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
              IGDB isn't configured — titles will be added manually without box art or metadata.
              You can configure IGDB in Settings and re-import later.
            </p>
          )}
          <div className="mb-4 flex items-center gap-3">
            <p className="mr-auto text-sm text-zinc-400">
              {active.length} of {items.length} titles will be added
            </p>
            <button
              onClick={() => setStage("input")}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Back
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
            {items.map((it, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2 last:border-0 ${
                  it.skipped ? "opacity-40" : ""
                }`}
              >
                <div className="h-12 w-9 flex-none overflow-hidden rounded bg-zinc-800">
                  {it.match?.coverSrc && (
                    <img src={it.match.coverSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-zinc-500">{it.raw}</p>
                  {it.candidates.length > 0 ? (
                    <select
                      value={it.match ? String(it.match.igdbId ?? it.match.gameId) : "manual"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setItem(i, {
                          match:
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
                  onClick={() => setItem(i, { skipped: !it.skipped })}
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
            onClick={() => {
              setStage("input");
              setText("");
              setItems([]);
              setResult(null);
            }}
            className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Import another list
          </button>
        </div>
      )}
    </Shell>
  );
}
