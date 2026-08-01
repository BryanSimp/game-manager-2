import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "../lib/auth.js";
import { api } from "../lib/api.js";

// stamped by CI via the APP_VERSION docker build-arg (short commit sha)
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || "dev";

/** Authenticated app shell: nav header + content. Redirects to /login when signed out. */
export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) navigate({ to: "/login" });
  }, [isPending, session, navigate]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: !!session });

  if (isPending || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">
        Loading…
      </main>
    );
  }

  async function signOut() {
    await authClient.signOut();
    navigate({ to: "/login" });
  }

  const link =
    "rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 [&.active]:bg-zinc-800 [&.active]:text-white";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link to="/" className="mr-4 text-lg font-bold tracking-tight">
            🎮 Game Manager
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            <Link to="/" className={link}>
              Library
            </Link>
            <Link to="/shelf" className={link}>
              Shelf
            </Link>
            <Link to="/collections" className={link}>
              Collections
            </Link>
            <Link to="/dashboard" className={link}>
              Dashboard
            </Link>
            <Link to="/add" className={link}>
              Add game
            </Link>
            <Link to="/import" className={link}>
              Import
            </Link>
            <Link to="/friends" className={link}>
              Friends
            </Link>
            <Link to="/tags" className={link}>
              Tags
            </Link>
            <Link to="/preferences" className={link}>
              Preferences
            </Link>
            {me.data?.role === "admin" && (
              <Link to="/settings" className={link}>
                Settings
              </Link>
            )}
          </nav>
          <span className="hidden text-sm text-zinc-500 sm:inline">{session.user.name}</span>
          <button
            onClick={signOut}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <span
        title="Deployed build"
        className="pointer-events-none fixed right-2 bottom-1.5 z-20 text-[10px] text-zinc-600 select-none"
      >
        v{APP_VERSION}
      </span>
    </div>
  );
}
