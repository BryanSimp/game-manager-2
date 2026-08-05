import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { exitDemo } from "../lib/demo.js";

/**
 * The strip above every screen during the tour.
 *
 * Deliberately **not** sticky: the app header already is, and two elements
 * competing for `top-0` means one covers the other on scroll. The header
 * carries a small "Demo" pill instead, so the state stays visible once this
 * has scrolled away — this band is the explanation and the two exits, and
 * those only need to be read once.
 */
export function DemoBanner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function leave() {
    exitDemo();
    // the cache is full of the demo account's library; a real visitor must
    // not see a frame of it after leaving
    queryClient.clear();
    navigate({ to: "/welcome" });
  }

  return (
    <div className="border-b border-indigo-800/60 bg-indigo-950/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
          Demo
        </span>
        <p className="min-w-0 flex-1 text-xs text-indigo-200">
          You're looking at a sample library — someone else's games, ratings and notes.{" "}
          <span className="text-indigo-300/70">Nothing here can be changed.</span>
        </p>
        <Link
          to="/register"
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
        >
          Create a free account
        </Link>
        <button
          onClick={leave}
          className="shrink-0 rounded-lg border border-indigo-700 px-3 py-1.5 text-xs text-indigo-200 transition hover:bg-indigo-900/60"
        >
          Exit demo
        </button>
      </div>
    </div>
  );
}
