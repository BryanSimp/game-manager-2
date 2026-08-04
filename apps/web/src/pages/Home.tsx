import { authClient } from "../lib/auth.js";
import { LandingPage } from "./Landing.js";
import { LibraryPage } from "./Library.js";

/**
 * What `/` serves.
 *
 * Signed out — including every crawler and every AdSense reviewer — gets the
 * public landing page, because the root of the domain has to be the front
 * door for anything to be indexed. Signed in keeps the behaviour the app
 * always had: `/` is your library.
 *
 * The landing page also lives at its own `/welcome` URL so a signed-in user
 * (or anyone linking to it) can still reach it.
 */
export function HomePage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">Loading…</main>
    );
  }

  return session ? <LibraryPage /> : <LandingPage />;
}
