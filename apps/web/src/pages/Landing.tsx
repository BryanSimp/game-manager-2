import { Link } from "@tanstack/react-router";
import { MarketingLayout, SectionHeading } from "../components/marketing/MarketingLayout.js";
import { Hero } from "../components/marketing/Hero.js";
import { FeatureShowcase } from "../components/marketing/FeatureShowcase.js";
import { GuidesHub } from "../components/marketing/GuidesHub.js";
import { Faq, FAQ_ITEMS } from "../components/marketing/Faq.js";
import { faqJsonLd, softwareApplicationJsonLd, useSeo } from "../lib/seo.js";

const STEPS = [
  {
    n: "01",
    title: "Bring your games in",
    body: "Link a Steam account and your PC library arrives with playtime attached. Scan barcodes for the shelf, paste a launcher screenshot for the storefronts with no API, or search and add by hand. Every route ends at a review step, so nothing lands in your library that you haven't seen.",
  },
  {
    n: "02",
    title: "Say what you actually intend to play",
    body: "Sort games into backlog, playing, finished, shelved and dropped — plus any category you invent for yourself. Owning a game and intending to play it are different facts, and separating them is what turns nine hundred games into a list you can read.",
  },
  {
    n: "03",
    title: "Track progress that means something",
    body: "Tick off story missions as you finish them and watch a real completion percentage appear, along with an estimate of the hours you have left. Then sort your backlog shortest-first and pick tonight's game in about four seconds.",
  },
];

const AUDIENCE = [
  {
    title: "The 900-game Steam account",
    body: "Years of bundles and sales have produced a library you no longer browse. Import it once, let playtime do the first sorting pass, and get back a shortlist instead of a wall.",
  },
  {
    title: "The multi-platform household",
    body: "A PC, two consoles, a handheld and a shelf of cartridges, with no single place that knows what you own. One library covers all of it, and answers 'do I already have this?' in a shop.",
  },
  {
    title: "The physical collector",
    body: "Cartridge, boxed, boxed with manual, sealed — completeness is most of what makes a physical collection interesting, and it gets recorded properly here rather than flattened to 'owned'.",
  },
  {
    title: "The completionist",
    body: "Mission lists, side-quest lists, achievement sync and per-game checklists, with completion tracked at the level you actually care about instead of a single vague percentage.",
  },
];

export function LandingPage() {
  useSeo({
    title: "Game Manager — track your game library, backlog and progress",
    description:
      "Game Manager is a free game library manager: sync your Steam library, catalogue physical and digital games across every console you own, track story progress mission by mission, and see how long your backlog will really take.",
    path: "/",
    jsonLd: [softwareApplicationJsonLd(), faqJsonLd(FAQ_ITEMS)],
  });

  return (
    <MarketingLayout variant="landing">
      <div className="space-y-20">
        <Hero />

        {/* ---- how it works ---- */}
        <section aria-labelledby="how-heading">
          <SectionHeading
            eyebrow="How it works"
            title="Three steps, then it maintains itself"
            blurb="Setting up a library is an afternoon at most, and much less if your collection is mostly digital. After that the upkeep is a few seconds when you finish a mission."
          />
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <span className="text-xs font-bold tracking-widest text-indigo-400">{step.n}</span>
                <h3 className="mt-2 text-base font-semibold text-zinc-100">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <FeatureShowcase />

        {/* ---- who it's for ---- */}
        <section aria-labelledby="audience-heading">
          <SectionHeading
            eyebrow="Who it's for"
            title="Built for collections that outgrew a spreadsheet"
            blurb="Game Manager assumes you own more games than you will ever finish, and is designed around that instead of pretending otherwise."
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {AUDIENCE.map((item) => (
              <div key={item.title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <h3 className="text-base font-semibold text-zinc-100">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <GuidesHub limit={6} />

        <Faq />

        {/* ---- closing CTA ---- */}
        <section className="rounded-2xl border border-indigo-900/60 bg-gradient-to-br from-indigo-950/50 to-zinc-900 px-6 py-12 text-center sm:px-10">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Find out what you actually own
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            Create an account, link Steam, and have a sorted library in about ten minutes. It's
            free, there's no card, and you can export or delete your data whenever you like.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white transition hover:bg-indigo-500"
            >
              Create a free account
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-base font-medium text-zinc-100 transition hover:bg-zinc-800"
            >
              Log in
            </Link>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
