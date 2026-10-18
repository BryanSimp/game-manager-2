import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_KEY_NAME_MAX, type CreatedApiKey } from "@gm/shared";
import { api } from "../lib/api.js";
import { CopyButton } from "./TwoFactorCard.js";

/**
 * Personal API keys, for connecting Claude Code (or any MCP client) to this
 * library.
 *
 * Three things the card is careful about:
 *
 *  - **A key is shown once.** The server keeps only a hash, so the moment
 *    after creating one is the only chance to copy it — the card says so, and
 *    hands over the full `claude mcp add` command with the key already in it,
 *    because that command is the reason anyone makes one.
 *  - **One key per device** is the shape it nudges towards (the name field
 *    asks for one). Revoking the laptop's key then doesn't disconnect the
 *    desktop.
 *  - **Revoking asks twice**, inline. Unlike unlinking a game, a revoked key
 *    can't be made again with one click: whatever was using it needs the new
 *    one pasted in by hand.
 */

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysCard() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.listApiKeys() });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<CreatedApiKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createApiKey({ name: name.trim() }),
    onSuccess: (created) => {
      setFresh(created);
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: (_result, id) => {
      setConfirming(null);
      if (fresh?.id === id) setFresh(null);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const endpoint = `${window.location.origin}/api/mcp`;
  const command = fresh
    ? `claude mcp add --transport http gamesmanager ${endpoint} --header "Authorization: Bearer ${fresh.key}"`
    : null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Let Claude read your library — "what should I play next?", "how far through this am I?".
        A key can only <em>read</em>, and only through the MCP connection at{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-300">{endpoint}</code>.
        Make one per device, so you can revoke one without the others.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {fresh && command ? (
        <div className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/40 p-3">
          <p className="text-sm text-emerald-300">
            Key “{fresh.name}” created. Copy it now — this is the only time it's shown.
          </p>
          <code className="mt-2 block break-all rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200">
            {fresh.key}
          </code>
          <p className="mt-3 text-sm text-zinc-300">To connect Claude Code, run:</p>
          <code className="mt-1 block break-all rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
            {command}
          </code>
          <p className="mt-1 text-xs text-zinc-500">
            Add <code>--scope user</code> to have it in every project, not just the current folder.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={fresh.key} label="Copy key" />
            <CopyButton text={command} label="Copy command" />
            <button
              type="button"
              onClick={() => setFresh(null)}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Name it after the device — e.g. Claude Code on my laptop"
            maxLength={API_KEY_NAME_MAX}
            aria-label="Key name"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {create.isPending ? "…" : "Create key"}
          </button>
        </form>
      )}

      {keys.data && keys.data.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {keys.data.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">{k.name ?? "Unnamed key"}</p>
                <p className="text-xs text-zinc-500">
                  {k.start ? <span className="font-mono">{k.start}…</span> : null} · created{" "}
                  {shortDate(k.createdAt)} ·{" "}
                  {k.lastUsedAt ? `last used ${shortDate(k.lastUsedAt)}` : "never used"}
                </p>
              </div>
              {confirming === k.id ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => revoke.mutate(k.id)}
                    disabled={revoke.isPending}
                    className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(k.id)}
                  className="shrink-0 rounded-lg border border-red-900 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-950"
                >
                  Revoke…
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : keys.data ? (
        <p className="mt-4 text-sm text-zinc-500">No keys yet.</p>
      ) : null}
    </section>
  );
}
