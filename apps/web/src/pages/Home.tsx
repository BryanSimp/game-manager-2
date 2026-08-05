import { authClient } from "../lib/auth.js";
import { useDemoMode } from "../lib/demo.js";
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
 * A demo visitor is signed out but wants the library: the tour is the real
 * app served from a seeded account, and its first screen is the same one
 * everyone else's is.
 *
 * The landing page also lives at its own `/welcome` URL so a signed-in user
 * (or anyone linking to it) can still reach it.
 */
export function HomePage() {
  const { data: session, isPending } = authClient.useSession();
  const demo = useDemoMode();

  if (isPending && !demo) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">Loading…</main>
    );
  }

  return session || demo ? <LibraryPage /> : <LandingPage />;
}
