/**
 * The web app's half of "Connect Claude" over OAuth.
 *
 * When claude.ai sends someone here to sign in, better-auth's oauth-provider
 * redirects to `/login` (or, once signed in, `/oauth/consent`) with the
 * original authorize request in the query string, signed. The
 * `oauthProviderClient` plugin in `lib/auth.ts` copies that signed query into
 * every auth request made from the page, and the server resumes the flow the
 * moment a session exists — after the password, or after the two-factor
 * code for an account that has one. All the pages have to do is notice the
 * answer is a redirect and follow it.
 */

/** Is this page part of an OAuth sign-in (it carries a signed authorize query)? */
export function isOAuthFlow(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.has("sig") && params.has("client_id");
}

/**
 * Follow a "continue the OAuth flow over there" answer from better-auth —
 * `{ redirect: true, url }` — with a full navigation, because the next stop
 * is the consent page or the app being connected, not a route in this SPA.
 * Returns whether it did, so the caller can skip its usual "go home".
 */
export function followOAuthRedirect(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const { redirect, url } = data as { redirect?: unknown; url?: unknown };
  if (redirect !== true || typeof url !== "string" || !url) return false;
  window.location.assign(url);
  return true;
}
