import { Link } from "@tanstack/react-router";
import { DemoButton } from "./DemoButton.js";

/** The numbers are about what the app tracks, not about usage — nothing here
 *  claims a user count we can't back up. */
const STATS = [
  { value: "1 library", label: "PC, console and handheld in one place" },
  { value: "7 categories", label: "Backlog, playing, finished — plus your own" },
  { value: "Mission-level", label: "Progress tracked story beat by story beat" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-indigo-950/40 via-zinc-900 to-zinc-950 px-6 py-14 sm:px-10 sm:py-20">
      {/* decorative glow — aria-hidden so it never lands in the a11y tree */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-600/20 blur-3xl"
      />

      <div className="relative max-w-3xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-indigo-800/60 bg-indigo-950/50 px-3 py-1 text-xs font-medium text-indigo-300">
          Free to use · Web and mobile · No credit card
        </p>

        <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
          Every game you own, finally in one library.
        </h1>

        <p className="mt-5 text-lg leading-7 text-zinc-300">
          Game Manager pulls your Steam library in automatically, catalogues the physical
          discs and cartridges on your shelf, and tells you the one thing no storefront
          ever will: what you actually have left to play, and how long it will take.
        </p>

        <p className="mt-4 text-base leading-7 text-zinc-400">
          Your backlog is spread across Steam, Epic, GOG, a PlayStation account, a Switch
          you haven't touched since spring, and a shelf of cartridges. Nothing talks to
          anything else, so the honest answer to "what should I play tonight?" is a shrug.
          Game Manager is the layer on top: one searchable library, real completion
          tracking down to individual story missions, and time-to-beat estimates that turn
          a 300-game pile into a plan you can actually finish.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/register"
            className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500"
          >
            Get started — it's free
          </Link>
          {/* the demo goes second, ahead of Log in: someone who has never
              seen the app wants to look before they decide, and this is the
              only button on the page that shows them anything */}
          <DemoButton className="rounded-xl border border-indigo-600 bg-indigo-950/40 px-6 py-3 text-base font-semibold text-indigo-200 transition hover:bg-indigo-900/50" />
          <Link
            to="/login"
            className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base font-medium text-zinc-100 transition hover:bg-zinc-800"
          >
            Log in
          </Link>
          <a
            href="#features"
            className="px-2 py-3 text-base font-medium text-indigo-400 underline-offset-4 transition hover:text-indigo-300 hover:underline"
          >
            See how it works ↓
          </a>
        </div>

        <dl className="mt-12 grid gap-6 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.value}>
              <dt className="text-xl font-bold text-white">{stat.value}</dt>
              <dd className="mt-1 text-sm leading-5 text-zinc-400">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
