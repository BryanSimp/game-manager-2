import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "../lib/auth.js";
import { api } from "../lib/api.js";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: "/login" });
    }
  }, [isPending, session, navigate]);

  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health() });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    enabled: !!session,
  });

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

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">🎮 Game Manager</h1>
        <button
          onClick={signOut}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Sign out
        </button>
      </header>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">
          Welcome, {session.user.name} 👋
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Email</dt>
            <dd>{session.user.email}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Role</dt>
            <dd className="capitalize">{me.data?.role ?? "…"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">API status</dt>
            <dd>
              {health.isLoading && "checking…"}
              {health.isError && <span className="text-red-400">unreachable</span>}
              {health.data && <span className="text-emerald-400">{health.data.status}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">API version</dt>
            <dd>{health.data?.version ?? "…"}</dd>
          </div>
        </dl>
      </section>

      <p className="mt-6 text-sm text-zinc-500">
        Phase 0 shell — the library, shelf, and import features arrive in the next phases.
      </p>
    </main>
  );
}
