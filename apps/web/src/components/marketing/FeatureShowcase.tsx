import { useState, type ReactNode } from "react";
import { SectionHeading } from "./MarketingLayout.js";

/* ------------------------------------------------------------------ *
 * Placeholder primitives
 *
 * The preview panel is a sketch of the real UI, not a screenshot: grey
 * blocks stand in for cover art and titles, while the labels, counts and
 * chips around them are real. That keeps the section honest (nothing here
 * pretends to be live data) and keeps it text-rich, which is what a crawler
 * reads. Swapping a block for a real <img> later is a local change.
 * ------------------------------------------------------------------ */

function Block({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-zinc-800 ${className}`} />;
}

function Cover({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`shrink-0 rounded-md bg-gradient-to-br from-zinc-700 to-zinc-800 ${className}`}
    />
  );
}

function Chip({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "indigo" | "emerald" }) {
  const tones = {
    zinc: "bg-zinc-800 text-zinc-300",
    indigo: "bg-indigo-950 text-indigo-300",
    emerald: "bg-emerald-950 text-emerald-300",
  };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Meter({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-medium text-zinc-300">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Fake app chrome so the preview reads as a screen rather than a card. */
function PreviewFrame({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-700" />
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-700" />
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-700" />
        <span className="ml-2 truncate font-mono text-[11px] text-zinc-500">{path}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The features
 * ------------------------------------------------------------------ */

interface Feature {
  id: string;
  name: string;
  tagline: string;
  body: string;
  points: string[];
  path: string;
  preview: ReactNode;
}

const FEATURES: Feature[] = [
  {
    id: "steam-sync",
    name: "Steam sync",
    tagline: "Your PC library imports itself",
    body: "Link your Steam account once and every owned game arrives with its playtime already attached. Matching goes by Steam app id rather than title, which is the only reliable way to tell two games with the same name apart, and achievements sync per game so completion percentages stay current without you touching anything.",
    points: [
      "Owned games matched by app id, not by name",
      "Playtime and achievement unlocks pulled from the official Steam Web API",
      "Anything ambiguous waits in a review queue instead of guessing",
      "Per-game overrides let you block or re-map a bad match for good",
    ],
    path: "gamesmanager.app/preferences",
    preview: (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">Steam import</span>
          <Chip tone="emerald">Connected</Chip>
        </div>
        <Meter pct={78} label="Importing 412 owned games" />
        <ul className="space-y-2 pt-1">
          {[
            { hours: "142h", chip: "Matched" },
            { hours: "38h", chip: "Matched" },
            { hours: "6h", chip: "Review" },
          ].map((row, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg bg-zinc-900 p-2">
              <Cover className="h-10 w-8" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Block className="h-2.5 w-2/3" />
                <Block className="h-2 w-1/3 bg-zinc-800/70" />
              </div>
              <span className="shrink-0 text-xs text-zinc-500">{row.hours}</span>
              <Chip tone={row.chip === "Matched" ? "emerald" : "indigo"}>{row.chip}</Chip>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "collections",
    name: "Collections & play order",
    tagline: "Build the run, then follow it",
    body: "Group games into collections — a series, a marathon, a themed run — and lay out the order you intend to play them in on a drag-and-drop graph. Collections can include games you don't own yet, because \"the Zelda games in chronological order\" is a reading list, not an inventory. Publish one and anyone can adopt their own private copy.",
    points: [
      "Drag nodes and draw links to set play order",
      "Roll-up stats: total hours, how far through the run you are",
      "Include games you don't own — they're flagged, not hidden",
      "Publish and adopt: an adopted copy is yours to rearrange",
    ],
    path: "gamesmanager.app/collections",
    preview: (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">The Zelda run</span>
          <Chip tone="indigo">Public</Chip>
        </div>
        <svg viewBox="0 0 320 120" className="w-full" role="img" aria-label="Play-order graph placeholder">
          <line x1="46" y1="60" x2="130" y2="34" stroke="#4f46e5" strokeWidth="2" />
          <line x1="46" y1="60" x2="130" y2="88" stroke="#3f3f46" strokeWidth="2" />
          <line x1="160" y1="34" x2="244" y2="60" stroke="#3f3f46" strokeWidth="2" />
          <line x1="160" y1="88" x2="244" y2="60" stroke="#3f3f46" strokeWidth="2" />
          {[
            { x: 30, y: 60, ring: "#10b981" },
            { x: 145, y: 34, ring: "#6366f1" },
            { x: 145, y: 88, ring: "#3f3f46" },
            { x: 259, y: 60, ring: "#3f3f46" },
          ].map((node, i) => (
            <g key={i}>
              <rect
                x={node.x - 15}
                y={node.y - 15}
                width="30"
                height="30"
                rx="6"
                fill="#27272a"
                stroke={node.ring}
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
          <Chip tone="emerald">1 finished</Chip>
          <Chip tone="indigo">1 playing</Chip>
          <Chip>2 queued</Chip>
          <Chip>≈ 140h total</Chip>
        </div>
      </div>
    ),
  },
  {
    id: "missions",
    name: "Mission progress",
    tagline: "Percent complete that means something",
    body: "\"Playing\" is not progress. Game Manager tracks a story mission by mission, grouped into chapters, so a game's completion figure reflects where you actually are in it. Tick off the mission you just finished and the estimate of time remaining updates from real time-to-beat data rather than a guess.",
    points: [
      "Mission lists imported from community wikis, or entered by hand",
      "Sequential mode: ticking mission 12 fills in 1–11 in one go",
      "Side quests tracked separately and deliberately untimed",
      "Time remaining derived from time-to-beat, not invented",
    ],
    path: "gamesmanager.app/game/1284",
    preview: (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Cover className="h-14 w-11" />
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-3 w-1/2" />
            <Block className="h-2 w-1/4 bg-zinc-800/70" />
          </div>
        </div>
        <Meter pct={24} label="12 of 51 missions · ≈ 26h left" />
        <ul className="space-y-1.5 pt-1">
          {[
            { done: true, chapter: "Chapter 2" },
            { done: true, chapter: "Chapter 2" },
            { done: false, chapter: "Chapter 3" },
            { done: false, chapter: "Chapter 3" },
          ].map((item, i) => (
            <li key={i} className="flex items-center gap-2.5 rounded-lg bg-zinc-900 px-2.5 py-2">
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] ${
                  item.done
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-zinc-700 bg-zinc-950"
                }`}
              >
                {item.done ? "✓" : ""}
              </span>
              <Block className={`h-2.5 flex-1 ${item.done ? "bg-zinc-800/60" : "bg-zinc-800"}`} />
              <Chip>{item.chapter}</Chip>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "consoles",
    name: "Consoles & storefronts",
    tagline: "One shelf per machine you own",
    body: "Your consoles list is the platform picker everywhere in the app, so it can never drift from what your games actually claim. PC storefronts sit underneath PC as sub-platforms: a game filed under Steam counts as a PC game in every total, while the badge still says Steam. Upload your own console art, or browse for it.",
    points: [
      "Steam, Epic, GOG, Battle.net and friends nest under PC",
      "Physical and digital tracked as separate ownership formats",
      "Per-console pages with their own filters and counts",
      "Console art is per-user — your Steam logo isn't everyone's",
    ],
    path: "gamesmanager.app/consoles",
    preview: (
      <div className="space-y-3">
        <span className="text-sm font-semibold text-zinc-200">Your consoles</span>
        <div className="grid grid-cols-3 gap-2">
          {["PC", "Switch", "PS5", "Steam", "GOG", "N64"].map((name, i) => (
            <div key={name} className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
              <Block className="mb-2 h-8 w-full bg-zinc-800/80" />
              <p className="truncate text-xs font-medium text-zinc-300">{name}</p>
              <p className="text-[10px] text-zinc-500">{[212, 48, 31, 194, 18, 12][i]} games</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "import",
    name: "Barcode & screenshot import",
    tagline: "Add a shelf in an afternoon",
    body: "Typing in 200 games is why most collection trackers die after a week. Scan a retail barcode with your phone and the product title is cleaned of SKUs and edition noise before it's matched. Paste a launcher screenshot and the titles are read off it, filtered for launcher chrome, and scored. Nothing enters your library until you confirm it.",
    points: [
      "Batch barcode scanning — queue a shelf, confirm once",
      "OCR on launcher screenshots and shelf photos",
      "Confidence scores on every match, with a re-search fallback",
      "The review step is the safety net: bad reads never auto-add",
    ],
    path: "gamesmanager.app/import",
    preview: (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">Review 14 matches</span>
          <Chip tone="indigo">Screenshot</Chip>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 px-3 py-4 text-center text-xs text-zinc-500">
          Drop a screenshot, paste from clipboard, or scan a barcode
        </div>
        <ul className="space-y-2">
          {[
            { pct: "96%", tone: "emerald" as const },
            { pct: "88%", tone: "emerald" as const },
            { pct: "61%", tone: "indigo" as const },
          ].map((row, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg bg-zinc-900 p-2">
              <Cover className="h-10 w-8" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Block className="h-2.5 w-3/5" />
                <Block className="h-2 w-2/5 bg-zinc-800/70" />
              </div>
              <Chip tone={row.tone}>{row.pct}</Chip>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "friends",
    name: "Friends & sharing",
    tagline: "Compare libraries, keep the notes private",
    body: "Add friends by a short friend code and see what you both own before you buy a co-op game twice. Adding is request-and-accept, so a code on its own never exposes a library, and your private notes are never part of what a friend can see. Collections and checklists you publish can be adopted by anyone as their own private copy.",
    points: [
      "Friend codes, with request-and-accept in both directions",
      "Overlap counts and an 'in common' filter on their library",
      "Private notes are never exposed to friends",
      "Publish a collection or checklist; adopters get their own copy",
    ],
    path: "gamesmanager.app/friends",
    preview: (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">Friends</span>
          <Chip>Code · K4M-92XR</Chip>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-lg bg-indigo-600 px-2.5 py-1 font-medium text-white">In common</span>
          <span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-zinc-300">Everything</span>
          <span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-zinc-300">Only theirs</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Cover className="aspect-[3/4] w-full" />
              <Block className="h-2 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

/**
 * The 'preview dashboard': a scrollable list of features on the left, a
 * sketched screen of the selected one on the right.
 *
 * Built as a tablist rather than an accordion so all six headings stay
 * visible — every one of them is a phrase somebody might search for, and a
 * collapsed accordion buries five of the six.
 */
export function FeatureShowcase() {
  const [activeId, setActiveId] = useState(FEATURES[0]!.id);
  const active = FEATURES.find((f) => f.id === activeId) ?? FEATURES[0]!;

  return (
    <section aria-labelledby="features-heading">
      <SectionHeading
        id="features"
        eyebrow="Preview dashboard"
        title="What you get, screen by screen"
        blurb="Pick a feature to see where it lives in the app. These are layout previews — grey blocks stand in for your own cover art and game titles."
      />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Feature list — scrolls on desktop so the panel beside it stays put */}
        <div
          role="tablist"
          aria-label="Feature previews"
          aria-orientation="vertical"
          className="flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1"
        >
          {FEATURES.map((feature) => {
            const selected = feature.id === active.id;
            return (
              <button
                key={feature.id}
                type="button"
                role="tab"
                id={`tab-${feature.id}`}
                aria-selected={selected}
                aria-controls={`panel-${feature.id}`}
                onClick={() => setActiveId(feature.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? "border-indigo-600 bg-indigo-950/30"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">{feature.name}</h3>
                  <span
                    aria-hidden="true"
                    className={`text-xs ${selected ? "text-indigo-400" : "text-zinc-600"}`}
                  >
                    →
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium text-indigo-400">{feature.tagline}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{feature.body}</p>
              </button>
            );
          })}
        </div>

        {/* Preview panel — sticky so it follows as the list scrolls */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div
            role="tabpanel"
            id={`panel-${active.id}`}
            aria-labelledby={`tab-${active.id}`}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5"
          >
            <PreviewFrame path={active.path}>{active.preview}</PreviewFrame>

            <h4 className="mt-5 text-sm font-semibold text-zinc-200">
              {active.name} — what it does for you
            </h4>
            <ul className="mt-3 space-y-2">
              {active.points.map((point) => (
                <li key={point} className="flex gap-2.5 text-sm leading-6 text-zinc-400">
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-500">
                    ✓
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
