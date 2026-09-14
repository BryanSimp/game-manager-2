import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CollectionListImport } from "@gm/shared";
import { api } from "../lib/api.js";

type Mode = "name" | "list";

/**
 * Creating a collection, either way round.
 *
 * "Name only" is the original one-field form: make an empty collection and
 * add games to it by search. "Paste a list" is the same affordance the import
 * page gives a library — a marathon you already have written down somewhere
 * goes in as twenty lines rather than twenty searches, and the order you
 * pasted becomes the collection's play order.
 *
 * The list is matched server-side in one request, so this is deliberately a
 * two-call flow: create, then fill. A failure on the second call leaves a real
 * (empty) collection rather than nothing, and the error says to try the paste
 * again from inside it — losing the name as well would be the worse trade.
 */
export function CreateCollection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("name");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<(CollectionListImport & { id: string }) | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const collection = await api.createCollection({ name: name.trim() });
      if (mode === "name" || !text.trim()) return { collection, filled: null };
      const filled = await api.addCollectionGamesFromList(collection.id, text);
      return { collection, filled };
    },
    onSuccess: ({ collection, filled }) => {
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (!filled) return;
      setText("");
      queryClient.invalidateQueries({ queryKey: ["collection", collection.id] });
      // Stay put and show what each line matched rather than bouncing to the
      // collection: a list of 30 titles usually has one or two the matcher
      // read differently, and this is the moment to see them.
      setImported({ ...filled, id: collection.id });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create"),
  });

  const lineCount = text.split("\n").filter((l) => l.trim()).length;

  return (
    <div className="mb-8">
      <div className="mb-3 flex gap-1 rounded-lg border border-zinc-700 p-0.5 sm:w-fit">
        {(
          [
            { key: "name", label: "Name only" },
            { key: "list", label: "📝 Paste a list" },
          ] as Array<{ key: Mode; label: string }>
        ).map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMode(m.key);
              setImported(null);
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition sm:flex-none ${
              mode === m.key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
        className="max-w-xl"
      >
        <div className="flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Legend of Zelda"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          {mode === "name" && (
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              Create
            </button>
          )}
        </div>

        {mode === "list" && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={
                "One game per line, in the order you'd play them:\n\n" +
                "The Legend of Zelda: Ocarina of Time\n" +
                "The Legend of Zelda: Majora's Mask\n" +
                "The Legend of Zelda: The Wind Waker"
              }
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!name.trim() || create.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
              >
                {create.isPending
                  ? "Matching titles…"
                  : `Create${lineCount > 0 ? ` with ${lineCount} game${lineCount === 1 ? "" : "s"}` : ""}`}
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
              <span className="text-xs text-zinc-600">
                Up to 50 lines. Games you don't own can be listed too.
              </span>
            </div>
          </>
        )}
      </form>

      {create.isPending && mode === "list" && (
        <p className="mt-3 text-sm text-zinc-500">
          Looking each title up — this takes a few seconds for a long list.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {imported && <ImportSummary result={imported} onOpen={(id) => navigate({ to: "/collection/$id", params: { id } })} />}
    </div>
  );
}

/**
 * What the paste actually did, line by line.
 *
 * Confident matches are collapsed to a count — nobody needs to read thirty
 * rows that went exactly where they were meant to. What gets listed is the
 * part worth a look: lines nothing matched, and matches the app had to
 * stretch for.
 */
function ImportSummary({
  result,
  onOpen,
}: {
  result: CollectionListImport & { id: string };
  onOpen: (id: string) => void;
}) {
  const misses = result.results.filter((r) => r.status === "unmatched" || r.status === "failed");
  // a match is "loose" when the title it landed on isn't close to what was
  // typed — filed, but the sort of thing worth glancing at
  const loose = result.results.filter((r) => r.status === "added" && r.confidence < 0.8);

  return (
    <div className="mt-4 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-sm">
        <span className="font-semibold text-emerald-400">{result.added} added</span>
        {result.duplicates > 0 && (
          <span className="text-zinc-500"> · {result.duplicates} already in it</span>
        )}
        {result.unmatched > 0 && (
          <span className="text-amber-400"> · {result.unmatched} not matched</span>
        )}
      </p>

      {loose.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Check these matches
          </p>
          <ul className="mt-1 space-y-1 text-sm text-zinc-400">
            {loose.map((r) => (
              <li key={r.input}>
                <span className="text-zinc-500">{r.input}</span> → {r.matched?.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {misses.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Nothing matched
          </p>
          <ul className="mt-1 space-y-1 text-sm text-zinc-400">
            {misses.map((r) => (
              <li key={r.input}>{r.input}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-zinc-600">
            Add these by hand from inside the collection — search finds things a whole-line match
            doesn't.
          </p>
        </div>
      )}

      <button
        onClick={() => onOpen(result.id)}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
      >
        Open the collection
      </button>
    </div>
  );
}
