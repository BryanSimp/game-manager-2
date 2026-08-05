import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { startDemoEdit } from "../lib/demo.js";

/**
 * Admin control of the demo library.
 *
 * Two jobs. **Build it** — the sample library used to exist only behind a
 * shell command, which is no use on a server you deploy to rather than sit
 * at. **Change it** — and that deliberately isn't a form on this page. "Edit
 * the demo" puts the whole app onto the demo account, so the tour is curated
 * with the same Library, Collections and Progress screens it's advertising.
 * A bespoke demo-content editor would be a second copy of twenty screens,
 * and it would be wrong within a phase.
 */
export function AdminDemoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const isAdmin = me.data?.role === "admin";

  const demo = useQuery({
    queryKey: ["admin-demo"],
    queryFn: () => api.getAdminDemo(),
    enabled: isAdmin,
    // only while a rebuild is in flight — the rest of the time this page is
    // static and polling it would be noise
    refetchInterval: (query) => (query.state.data?.seed.running ? 1500 : false),
  });

  const rebuild = useMutation({
    mutationFn: () => api.seedDemo(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-demo"] }),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDemo(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-demo"] });
      queryClient.invalidateQueries({ queryKey: ["demo-status"] });
    },
  });

  if (me.data && !isAdmin) {
    return (
      <Shell>
        <p className="text-zinc-400">Admin access required.</p>
      </Shell>
    );
  }

  const stats = demo.data?.stats;
  const seed = demo.data?.seed;
  const running = seed?.running ?? false;

  function edit() {
    startDemoEdit();
    // the cache holds the admin's own library; the next screen is the demo's
    queryClient.clear();
    navigate({ to: "/" });
  }

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-zinc-100">Demo library</h1>
        <p className="text-sm text-zinc-500">
          The sample library behind the “Try the demo” button. Visitors see it read-only; you
          edit it as yourself.
        </p>
      </div>

      {demo.isError && (
        <p className="mb-4 text-sm text-red-400">Couldn't load the demo status — is the API up?</p>
      )}

      {stats && !stats.exists ? (
        <section className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-center">
          <h2 className="text-base font-semibold text-zinc-100">No demo library yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-400">
            Build it once and the “Try the demo” button on the landing page starts working.
            It creates a sample account with about two dozen games across a PC, a Switch, a PS5
            and a retro shelf, plus collections, mission lists, tags and two friends.
          </p>
          <button
            onClick={() => rebuild.mutate()}
            disabled={running || rebuild.isPending}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {running ? "Building…" : "Build the demo library"}
          </button>
        </section>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Games" value={stats?.games} />
            <Tile label="Collections" value={stats?.collections} />
            <Tile label="Lists" value={stats?.lists} />
            <Tile label="Tags" value={stats?.tags} />
            <Tile label="Consoles" value={stats?.consoles} />
            <Tile label="Friends" value={stats?.friends} />
          </div>

          <section className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Edit what visitors see</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Opens the app as{" "}
              <span className="text-zinc-200">{stats?.name ?? "the demo account"}</span>. Add and
              remove games, write notes, build collections, tick off missions — every screen works
              normally, and everything you change is what the demo shows. Your own library is
              untouched until you click “Done editing”.
            </p>
            <button
              onClick={edit}
              disabled={running}
              className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              Edit the demo library →
            </button>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Rebuild from the template</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Throws away every change and rebuilds the demo from the curated list in the code.
              Use it to undo a session of editing, or to refresh the tour after a feature lands.
              It never touches a real account.
            </p>
            {demo.data && !demo.data.igdbConfigured && (
              <p className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                IGDB isn't configured, so a rebuild will create games with no cover art or play
                times. Add credentials in Settings first for a demo worth showing.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  if (confirm("Rebuild the demo library? Any editing you've done is discarded.")) {
                    rebuild.mutate();
                  }
                }}
                disabled={running || rebuild.isPending}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {running ? "Rebuilding…" : "Rebuild"}
              </button>
              <button
                onClick={() => {
                  if (confirm("Delete the demo library entirely? The Try-the-demo button will stop working.")) {
                    remove.mutate();
                  }
                }}
                disabled={running || remove.isPending}
                className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
              >
                Delete the demo
              </button>
              {seed?.error && <span className="text-xs text-red-400">{seed.error}</span>}
              {rebuild.isError && (
                <span className="text-xs text-red-400">
                  {rebuild.error instanceof Error ? rebuild.error.message : "Couldn't start"}
                </span>
              )}
            </div>

            {seed && seed.log.length > 0 && (
              <details className="mt-4" open={running}>
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                  Build log
                  {seed.finishedAt && !running
                    ? ` · finished ${new Date(seed.finishedAt).toLocaleString()}`
                    : ""}
                </summary>
                <pre className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-5 text-zinc-400">
                  {seed.log.join("\n")}
                </pre>
              </details>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

function Tile({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value ?? "—"}</div>
    </div>
  );
}
