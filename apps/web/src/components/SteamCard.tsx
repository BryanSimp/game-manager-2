import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Link a Steam account, import the library, sync achievements/playtime. */
export function SteamCard() {
  const queryClient = useQueryClient();
  const [steamInput, setSteamInput] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const status = useQuery({
    queryKey: ["steam"],
    queryFn: () => api.getSteamStatus(),
    refetchInterval: (query) =>
      query.state.data?.importing || query.state.data?.syncing ? 3000 : false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["steam"] });

  const link = useMutation({
    mutationFn: () => api.linkSteam(steamInput.trim()),
    onSuccess: (res) => {
      setMessage({
        kind: "ok",
        text: `Linked${res.personaName ? ` as ${res.personaName}` : ""} (${res.steamId})`,
      });
      setSteamInput("");
      refresh();
    },
    onError: (err) =>
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Link failed" }),
  });

  const unlink = useMutation({
    mutationFn: () => api.unlinkSteam(),
    onSuccess: () => {
      setMessage(null);
      refresh();
    },
  });

  const startImport = useMutation({
    mutationFn: () => api.startSteamImport(),
    onSuccess: () => {
      setMessage({
        kind: "ok",
        text: "Import started — exact matches land in your library; anything uncertain appears on the Import page for review.",
      });
      refresh();
    },
    onError: (err) =>
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Import failed" }),
  });

  const startSync = useMutation({
    mutationFn: () => api.startSteamSync(),
    onSuccess: () => {
      setMessage({
        kind: "ok",
        text: "Achievement sync started — this walks every linked game, so give it a few minutes.",
      });
      refresh();
    },
    onError: (err) =>
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Sync failed" }),
  });

  const s = status.data;
  if (!s) return null;

  return (
    <section className="mb-6 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-lg font-semibold">Steam</h2>

      {!s.configured ? (
        <p className="mt-1 text-sm text-amber-400">
          The server has no Steam API key yet — an admin can add one in Settings.
        </p>
      ) : !s.linked ? (
        <>
          <p className="mt-1 text-sm text-zinc-400">
            Link your account to import your whole Steam library (no OCR needed) and track
            achievements. Your profile's <span className="text-zinc-300">Game details</span> privacy
            setting must be <span className="text-zinc-300">Public</span>.
          </p>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (steamInput.trim()) link.mutate();
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={steamInput}
              onChange={(ev) => setSteamInput(ev.target.value)}
              placeholder="SteamID64, vanity name, or profile URL"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!steamInput.trim() || link.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {link.isPending ? "Linking…" : "Link"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-400">
            Linked to{" "}
            <span className="font-medium text-zinc-200">{s.personaName ?? s.steamId}</span>
            {s.lastImportAt && (
              <> · last import {new Date(s.lastImportAt).toLocaleDateString()}</>
            )}
            {s.lastSyncAt && <> · last sync {new Date(s.lastSyncAt).toLocaleDateString()}</>}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => startImport.mutate()}
              disabled={s.importing || startImport.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {s.importing ? "Importing…" : "Import Steam library"}
            </button>
            <button
              onClick={() => startSync.mutate()}
              disabled={s.syncing || startSync.isPending}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {s.syncing ? "Syncing…" : "Sync achievements & playtime"}
            </button>
            <button
              onClick={() => {
                if (confirm("Unlink this Steam account?")) unlink.mutate();
              }}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              Unlink
            </button>
          </div>
        </>
      )}

      {message && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "border-emerald-900 bg-emerald-950 text-emerald-300"
              : "border-red-900 bg-red-950 text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
