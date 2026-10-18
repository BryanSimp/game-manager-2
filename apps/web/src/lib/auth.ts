import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Same origin in dev (vite proxy) and prod (Traefik path routing).
export const authClient = createAuthClient({
  basePath: "/api/auth",
  // No `twoFactorPage` / `onTwoFactorRedirect`: the sign-in form swaps itself
  // for the code prompt in place. better-auth's own docs warn that the
  // redirect option forces a full page reload, and a reload mid-sign-in
  // throws away the typed email for no gain — the challenge is two fields on
  // a form we're already looking at.
  //
  // `oauthProviderClient` adds the page's signed OAuth query to auth requests
  // made while signing in for a connected app (see lib/oauth.ts). On every
  // other page there's no signed query, and it does nothing.
  plugins: [twoFactorClient(), oauthProviderClient()],
});
