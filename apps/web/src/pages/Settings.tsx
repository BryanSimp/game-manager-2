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
  const [steamKey, setSteamKey] = useState("");
  const [steamMessage, setSteamMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const [sgdbKey, setSgdbKey] = useState("");
  const [sgdbMessage, setSgdbMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [emailKey, setEmailKey] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailMessage, setEmailMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const saveEmail = useMutation({
    mutationFn: () => api.saveEmailSettings(emailKey.trim(), emailFrom.trim() || undefined),
    onSuccess: () => {
      setEmailKey("");
      setEmailMessage({ kind: "ok", text: "Resend key saved — password reset emails are on." });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (err) =>
      setEmailMessage({ kind: "err", text: err instanceof Error ? err.message : "Save failed" }),
  });

  const testEmail = useMutation({
    mutationFn: () => api.testEmail(),
    onSuccess: () =>
      setEmailMessage({ kind: "ok", text: "Test email sent — check your inbox." }),
    onError: (err) =>
      setEmailMessage({
        kind: "err",
        text: `Test failed: ${err instanceof Error ? err.message : "unknown error"}`,
      }),
  });

  const saveSgdb = useMutation({
    mutationFn: () => api.saveSteamGridDbApiKey(sgdbKey.trim()),
    onSuccess: () => {
      setSgdbKey("");
      setSgdbMessage({ kind: "ok", text: "SteamGridDB key saved — cover browsing is on." });
      settings.refetch();
    },
    onError: (err) =>
      setSgdbMessage({ kind: "err", text: err instanceof Error ? err.message : "Save failed" }),
  });

  const saveSteam = useMutation({
    mutationFn: () => api.saveSteamApiKey(steamKey.trim()),
    onSuccess: () => {
      setSteamKey("");
      setSteamMessage({ kind: "ok", text: "Steam API key saved — users can now link accounts in Preferences." });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (err) =>
      setSteamMessage({ kind: "err", text: err instanceof Error ? err.message : "Save failed" }),
  });

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

      <section className="mt-6 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Steam Web API</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Powers Steam library import, playtime, and achievement sync. Status:{" "}
          {settings.data?.steamConfigured ? (
            <span className="font-medium text-emerald-400">configured</span>
          ) : (
            <span className="font-medium text-amber-400">not configured</span>
          )}
        </p>
        <ol className="mt-4 list-inside list-decimal space-y-1 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
          <li>
            Go to{" "}
            <a
              href="https://steamcommunity.com/dev/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              steamcommunity.com/dev/apikey
            </a>{" "}
            (any Steam account works, it's free)
          </li>
          <li>Domain name: anything (e.g. localhost)</li>
          <li>Copy the key and paste it here</li>
        </ol>
        <div className="mt-4 space-y-3">
          <input
            value={steamKey}
            onChange={(e) => setSteamKey(e.target.value)}
            placeholder="Steam Web API key"
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => saveSteam.mutate()}
            disabled={!steamKey.trim() || saveSteam.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {saveSteam.isPending ? "Saving…" : "Save"}
          </button>
          {steamMessage && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                steamMessage.kind === "ok"
                  ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                  : "border-red-900 bg-red-950 text-red-300"
              }`}
            >
              {steamMessage.text}
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">SteamGridDB</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Powers the “Browse covers online” button on a game page — community box art you can
          swap in. Status:{" "}
          {settings.data?.steamGridDbConfigured ? (
            <span className="font-medium text-emerald-400">configured</span>
          ) : (
            <span className="font-medium text-amber-400">not configured</span>
          )}
        </p>
        <ol className="mt-4 list-inside list-decimal space-y-1 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
          <li>
            Sign in at{" "}
            <a
              href="https://www.steamgriddb.com/profile/preferences/api"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              steamgriddb.com/profile/preferences/api
            </a>{" "}
            (free)
          </li>
          <li>Generate an API key and paste it here</li>
        </ol>
        <div className="mt-4 space-y-3">
          <input
            value={sgdbKey}
            onChange={(e) => setSgdbKey(e.target.value)}
            placeholder="SteamGridDB API key"
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => saveSgdb.mutate()}
            disabled={!sgdbKey.trim() || saveSgdb.isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {saveSgdb.isPending ? "Saving…" : "Save"}
          </button>
          {sgdbMessage && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                sgdbMessage.kind === "ok"
                  ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                  : "border-red-900 bg-red-950 text-red-300"
              }`}
            >
              {sgdbMessage.text}
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Email (Resend)</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Powers "Forgot password?" reset emails. Status:{" "}
          {settings.data?.emailConfigured ? (
            <span className="font-medium text-emerald-400">
              configured{settings.data.emailFrom ? ` (sending as ${settings.data.emailFrom})` : ""}
            </span>
          ) : (
            <span className="font-medium text-amber-400">not configured</span>
          )}
        </p>
        <ol className="mt-4 list-inside list-decimal space-y-1 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
          <li>
            Create an API key at{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              resend.com/api-keys
            </a>{" "}
            (free tier is plenty for resets)
          </li>
          <li>
            To send from your own domain, verify it under Domains first — without one, emails go
            out via Resend's test sender and only reach the Resend account owner
          </li>
        </ol>
        <div className="mt-4 space-y-3">
          <input
            value={emailKey}
            onChange={(e) => setEmailKey(e.target.value)}
            placeholder="Resend API key"
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder='From address (optional) — e.g. Game Manager <noreply@yourdomain.com>'
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <div className="flex gap-3">
            <button
              onClick={() => saveEmail.mutate()}
              disabled={!emailKey.trim() || saveEmail.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {saveEmail.isPending ? "Saving…" : "Save"}
            </button>
            {settings.data?.emailConfigured && (
              <button
                onClick={() => testEmail.mutate()}
                disabled={testEmail.isPending}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {testEmail.isPending ? "Sending…" : "Send test email"}
              </button>
            )}
          </div>
          {emailMessage && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm ${
                emailMessage.kind === "ok"
                  ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                  : "border-red-900 bg-red-950 text-red-300"
              }`}
            >
              {emailMessage.text}
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}
