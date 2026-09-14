import { GITHUB_REPO_URL } from "@gm/shared";
import { SectionHeading } from "./MarketingLayout.js";

/**
 * Shared by the rendered FAQ and by the FAQPage structured data on the
 * landing page — one source, so the schema can never describe questions the
 * page doesn't actually answer (which Google treats as a violation).
 *
 * `link` is rendered after the answer but deliberately kept *out* of it: the
 * FAQPage schema wants a plain-text answer, so an anchor is page furniture
 * rather than part of the answer Google is shown.
 */
export const FAQ_ITEMS: Array<{
  question: string;
  answer: string;
  link?: { href: string; label: string };
}> = [
  {
    question: "Is Game Manager free?",
    answer:
      "Yes. Every feature is free — creating an account, importing your library, tracking progress, building collections and sharing them. There are no ads, no trial period, no card required to sign up, and nothing is held back behind a paid tier.",
  },
  {
    question: "Can I try it without signing up?",
    answer:
      "Yes. The demo opens a sample library — a few hundred hours of games across a PC, a Switch, a PS5 and a shelf of N64 cartridges, with collections, mission lists and friends already set up — and lets you click through every screen. It is strictly read-only: nothing you do in the demo changes anything, and the account is not yours to keep. Signing up gives you an empty library of your own.",
  },
  {
    question: "Which platforms can I track games on?",
    answer:
      "All of them. PC storefronts — Steam, Epic, GOG, Battle.net, EA App, Ubisoft Connect, Xbox and itch.io — are modelled as sub-platforms of PC, so a Steam game counts as a PC game while still showing where you own it. Consoles and handhelds from the cartridge era through to current generation are supported, with physical and digital tracked as separate ownership formats.",
  },
  {
    question: "Does importing my Steam library add everything automatically?",
    answer:
      "Games that match confidently are added with their playtime attached. Anything ambiguous goes to a review queue instead, because matching by title alone gets re-releases and same-named games wrong. Matching is done by Steam app id wherever possible, which resolves those cases exactly.",
  },
  {
    question: "Can I add physical games?",
    answer:
      "Yes, and there are two fast routes. Scan retail barcodes with the mobile app — scans batch, so you can work through a shelf and confirm once — or add games by search and mark them physical rather than digital. Either way they live in the same library as your downloads, filed under the console they belong to.",
  },
  {
    question: "What does mission progress tracking actually do?",
    answer:
      "It records where you are in a game's story mission by mission, rather than just marking it 'playing'. Combined with time-to-beat data, that produces an estimate of how long you have left in each game — which is what makes a backlog sortable by what you could realistically finish.",
  },
  {
    question: "Can my friends see my library?",
    answer:
      "Only if you add them, and only what you choose to share. Friends are added by a short code with a request-and-accept step, so a code on its own never exposes anything. A friend can see status, rating, platforms and completion on your games — never your private notes.",
  },
  {
    question: "Is there a mobile app?",
    answer:
      "Yes. The mobile app shares one account and one library with the web app, and covers your library, dashboard, collections, consoles, friends, barcode scanning and import review, with offline caching so a dropped signal doesn't empty the screen. Collection play-order editing, list authoring, and managing consoles and custom categories are currently web-only.",
  },
  {
    question: "Can I export or delete my data?",
    answer:
      "Your library is yours, and on a self-hosted instance it never leaves your own database. A one-click export is not built yet — it is on the roadmap. To have your account and everything in it deleted in the meantime, contact the operator of the instance you signed up on and it will be removed.",
  },
  {
    question: "Can I self-host it?",
    answer:
      "Yes, and the source is public. Game Manager runs as a small set of Docker containers — an API, the web app and a PostgreSQL database — behind whatever reverse proxy you already use. Clone the repository, copy the example env file, and bring the stack up with Docker Compose; the README walks through it. Your library data stays on your own server.",
    link: { href: GITHUB_REPO_URL, label: "View the source and setup guide on GitHub" },
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-heading">
      <SectionHeading
        id="faq"
        eyebrow="Questions"
        title="Frequently asked questions"
        blurb="If something here isn't covered, the contact form goes straight to a person."
      />

      <dl className="mt-8 divide-y divide-zinc-800 border-t border-zinc-800">
        {FAQ_ITEMS.map((item) => (
          <div key={item.question} className="py-5">
            <dt className="text-sm font-semibold text-zinc-100">{item.question}</dt>
            <dd className="mt-2 text-sm leading-6 text-zinc-400">
              {item.answer}
              {item.link && (
                <a
                  href={item.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block font-medium text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300"
                >
                  {item.link.label} ↗
                </a>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
