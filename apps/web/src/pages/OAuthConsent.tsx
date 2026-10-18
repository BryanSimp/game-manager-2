import { useEffect, useState } from "react";
import { OAUTH_SCOPE_LABELS } from "@gm/shared";
import { authClient } from "../lib/auth.js";
import { followOAuthRedirect, isOAuthFlow } from "../lib/oauth.js";
import { AuthCard } from "../components/AuthCard.js";

/**
 * "Claude wants read access to your Game Manager library" — Allow or Deny.
 *
 * better-auth's oauth-provider sends a signed-in person here the first time
 * an app (claude.ai's connector, usually) asks for their library; later
 * sign-ins by the same app skip it, until they disconnect it on Preferences.
 * Login and two-factor have already happened by the time this renders: the
 * provider only sends someone here with a session.
 *
 * The app's name is whatever it called itself when it registered — anyone
 * can register — so the page also says where it will send you back to. That
 * host is the part the server vouched for: registration only accepts
 * Claude's callbacks, loopback addresses, and URIs the operator allowed.
 *
 * Allow and Deny both end in a full navigation back to the app; Deny tells it
 * "access_denied" rather than leaving it waiting.
 */

interface PublicClient {
  client_name?: string;
  client_uri?: string;
}

function redirectHostOf(search: URLSearchParams): string | null {
  const uri = search.get("redirect_uri");
  if (!uri) return null;
  try {
    const url = new URL(uri);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? "an app on this computer"
      : url.host;
  } catch {
    return null;
  }
}

export function OAuthConsentPage() {
  const session = authClient.useSession();
  const search = new URLSearchParams(window.location.search);
  const clientId = search.get("client_id");
  const scopes = (search.get("scope") ?? "").split(" ").filter(Boolean);
  const backTo = redirectHostOf(search);

  const [client, setClient] = useState<PublicClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);

  useEffect(() => {
    if (!clientId || !session.data) return;
    let cancelled = false;
    authClient
      .$fetch<PublicClient>("/oauth2/public-client", { method: "GET", query: { client_id: clientId } })
      .then(({ data }) => {
        if (!cancelled) setClient(data ?? {});
      })
      .catch(() => {
        if (!cancelled) setClient({});
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, session.data]);

  async function decide(accept: boolean) {
    setError(null);
    setBusy(accept ? "allow" : "deny");
    // the signed query is added by oauthProviderClient (lib/auth.ts)
    const { data, error: consentError } = await authClient.$fetch<{ redirect?: boolean; url?: string }>(
      "/oauth2/consent",
      { method: "POST", body: { accept } },
    );
    if (consentError || !followOAuthRedirect(data)) {
      setBusy(null);
      setError(consentError?.message ?? "Something went wrong — start connecting again from the app.");
    }
  }

  if (!isOAuthFlow() || !clientId) {
    return (
      <AuthCard title="Connect an app">
        <p className="text-sm text-zinc-400">
          This page is part of connecting an app like Claude to your library, and it's missing the
          details of which app. Start again from the app you were connecting.
        </p>
      </AuthCard>
    );
  }

  if (session.isPending) {
    return (
      <AuthCard title="Connect an app">
        <div className="h-32 animate-pulse rounded-lg bg-zinc-800" />
      </AuthCard>
    );
  }

  if (!session.data) {
    return (
      <AuthCard title="Connect an app">
        <p className="text-sm text-zinc-400">Your session ended. Sign in again to carry on.</p>
        <a
          href={`/login${window.location.search}`}
          className="mt-4 block w-full rounded-lg bg-indigo-600 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in
        </a>
      </AuthCard>
    );
  }

  const appName = client?.client_name?.trim() || "An app";

  return (
    <AuthCard title="Connect an app">
      <h2 className="text-center text-lg font-semibold text-zinc-100">
        {client ? `${appName} wants read access to your Game Manager library` : "…"}
      </h2>

      <ul className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300">
        {(scopes.length > 0 ? scopes : ["library:read"]).map((scope) => (
          <li key={scope} className="flex gap-2">
            <span aria-hidden className="text-emerald-400">
              ✓
            </span>
            <span>{OAUTH_SCOPE_LABELS[scope] ?? scope}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-zinc-500">
        Signed in as {session.data.user.name} ({session.data.user.email})
        {backTo ? <> · you'll go back to {backTo}</> : null}. You can disconnect it any time under
        Preferences → API keys.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy === "deny" ? "…" : "Deny"}
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={busy !== null || !client}
          className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === "allow" ? "…" : "Allow"}
        </button>
      </div>
    </AuthCard>
  );
}
