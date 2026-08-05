import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { startDemo } from "../lib/demo.js";
import { MarketingLayout } from "../components/marketing/MarketingLayout.js";

/**
 * `/demo` — the door into the tour.
 *
 * It asks the server whether there's a demo to show before flipping the flag.
 * That check is why the button on the landing page can be unconditional: an
 * instance where nobody has built the demo yet says so here, in a sentence,
 * with somewhere to go next — which is a great deal better than the button
 * quietly not existing and leaving an admin to guess why.
 *
 * The query cache is cleared on the way in for the same reason `Exit demo`
 * clears it on the way out — a signed-in user who follows a demo link must
 * not see their own library rendered under a Demo banner, or vice versa.
 */
export function DemoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [entered, setEntered] = useState(false);

  const status = useQuery({
    queryKey: ["demo-status"],
    queryFn: () => api.demoStatus(),
    retry: false,
  });
  // only meaningful to an admin, and it 401s for everyone else — which is
  // fine, the failure just leaves `me.data` undefined
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), retry: false });

  const available = status.data?.available;

  useEffect(() => {
    if (!available || entered) return;
    setEntered(true);
    startDemo();
    queryClient.clear();
    // replace: Back should return to the landing page, not bounce through
    // this redirect and straight back into the demo
    navigate({ to: "/", replace: true });
  }, [available, entered, navigate, queryClient]);

  if (status.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">Loading…</main>
    );
  }

  if (available) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">
        Opening the demo…
      </main>
    );
  }

  const isAdmin = me.data?.role === "admin";

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-xl py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          The demo isn't set up on this server yet
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          The tour runs on a sample library that an administrator has to build first. Nothing is
          broken — there's just nothing to show you yet.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            to="/register"
            className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-indigo-500"
          >
            Create a free account
          </Link>
          <Link
            to="/welcome"
            className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base font-medium text-zinc-100 transition hover:bg-zinc-800"
          >
            Back to the tour of features
          </Link>
        </div>

        {isAdmin && (
          <p className="mt-8 rounded-xl border border-indigo-900/60 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-200">
            You're an admin —{" "}
            <Link to="/admin/demo" className="font-semibold underline hover:text-indigo-100">
              build the demo library
            </Link>{" "}
            and this page becomes the tour.
          </p>
        )}
      </div>
    </MarketingLayout>
  );
}
