import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { exitDemo } from "../lib/demo.js";

/**
 * The strip an admin sees while curating the demo library.
 *
 * Amber rather than indigo, and it says whose library this is, because the
 * failure mode it guards against is real: every screen looks exactly like
 * your own app, and someone who forgets will "tidy up" a library that isn't
 * theirs and wonder later where their games went.
 */
export function DemoEditBanner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function leave() {
    exitDemo();
    // the cache is full of the demo's library; the admin's own must not be
    // rendered from it a frame later
    queryClient.clear();
    navigate({ to: "/admin/demo" });
  }

  return (
    <div className="border-b border-amber-700/60 bg-amber-950/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
          Editing demo
        </span>
        <p className="min-w-0 flex-1 text-xs text-amber-200">
          Everything you change here is the <strong className="font-semibold">demo library</strong>{" "}
          visitors see — not your own.
        </p>
        <button
          onClick={leave}
          className="shrink-0 rounded-lg border border-amber-700 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-900/60"
        >
          Done editing
        </button>
      </div>
    </div>
  );
}

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
