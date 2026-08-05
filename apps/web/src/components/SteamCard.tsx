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
    // width and spacing come from the preferences grid this sits in
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
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
          <SteamRules />
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

/**
 * Apps the importer has been told about by hand: skipped entirely, or pinned
 * to a particular game. Rules are made from a game's page ("wrong match?");
 * this is where they're reviewed and undone.
 */
function SteamRules() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["steam-rules"], queryFn: () => api.getSteamRules() });

  const remove = useMutation({
    mutationFn: (steamAppId: number) => api.deleteSteamRule(steamAppId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["steam-rules"] }),
  });

  const list = rules.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <p className="text-sm font-semibold text-zinc-300">Import rules</p>
      <p className="mt-1 text-xs text-zinc-500">
        Set from a game's page when an import matched the wrong thing. They apply to every
        import from now on.
      </p>
      <ul className="mt-3 space-y-1.5">
        {list.map((rule) => (
          <li key={rule.steamAppId} className="flex items-center gap-2 text-sm">
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                rule.action === "block"
                  ? "bg-red-950 text-red-300"
                  : "bg-indigo-950 text-indigo-300"
              }`}
            >
              {rule.action === "block" ? "never import" : "always import as"}
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-400">
              {rule.action === "map" ? (
                <span className="text-zinc-200">{rule.gameTitle ?? "a game you picked"}</span>
              ) : (
                <span className="text-zinc-200">{rule.appName ?? `Steam app ${rule.steamAppId}`}</span>
              )}
              <span className="text-zinc-600"> · app {rule.steamAppId}</span>
            </span>
            <button
              onClick={() => remove.mutate(rule.steamAppId)}
              title="Drop this rule"
              className="px-1 text-xs text-zinc-600 hover:text-red-400"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
