import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.getAdminSettings() });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => api.saveIgdbCredentials(clientId.trim(), clientSecret.trim()),
    onSuccess: async () => {
      setMessage(null);
      try {
        await api.testIgdb();
        setMessage({ kind: "ok", text: "Saved — IGDB connection works! Game search is now live." });
      } catch (err) {
        setMessage({
          kind: "err",
          text: `Saved, but the test failed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }
      setClientId("");
      setClientSecret("");
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (err) =>
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Save failed" }),
  });

  const test = useMutation({
    mutationFn: () => api.testIgdb(),
    onSuccess: () => setMessage({ kind: "ok", text: "IGDB connection works!" }),
    onError: (err) =>
      setMessage({
        kind: "err",
        text: `Test failed: ${err instanceof Error ? err.message : "unknown error"}`,
      }),
  });

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-bold">Settings</h1>

      <section className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">IGDB (game database)</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Powers game search, box art, metadata, and how-long-to-beat times. Status:{" "}
          {settings.data?.igdbConfigured ? (
            <span className="font-medium text-emerald-400">
              configured ({settings.data.igdbClientId})
            </span>
          ) : (
            <span className="font-medium text-amber-400">not configured</span>
          )}
        </p>

        <ol className="mt-4 list-inside list-decimal space-y-1 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
          <li>
            Go to{" "}
            <a
              href="https://dev.twitch.tv/console/apps"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              dev.twitch.tv/console/apps
            </a>{" "}
            (IGDB is run by Twitch — a normal Twitch account works, it's free)
          </li>
          <li>Click "Register Your Application"</li>
          <li>
            Name: anything · OAuth Redirect URL: <code className="text-zinc-300">http://localhost</code> ·
            Category: Application Integration · Client Type: Confidential
          </li>
          <li>Copy the Client ID, then click "New Secret" and copy the Client Secret</li>
        </ol>

        <div className="mt-4 space-y-3">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Twitch Client ID"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Twitch Client Secret"
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <div className="flex gap-3">
            <button
              onClick={() => save.mutate()}
              disabled={!clientId.trim() || !clientSecret.trim() || save.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save & test"}
            </button>
            {settings.data?.igdbConfigured && (
              <button
                onClick={() => test.mutate()}
                disabled={test.isPending}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>
          {message && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                message.kind === "ok"
                  ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                  : "border-red-900 bg-red-950 text-red-300"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}
