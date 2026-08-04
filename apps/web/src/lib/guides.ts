/**
 * Content for the Gaming Guides hub.
 *
 * Kept as plain data rather than MDX or a CMS: there are a handful of
 * articles, they change rarely, and holding them here means the guide hub,
 * the article pages and the sitemap all read from one list that can't fall out
 * of sync. Adding a guide is one entry — the route, the card and the sitemap
 * pick it up automatically.
 *
 * These pages are the reason the site has anything for a search engine to
 * index, so they are written to be genuinely useful on their own: someone who
 * never signs up should still leave with the answer they came for.
 */

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  /** One-sentence summary — the card blurb and the meta description. */
  excerpt: string;
  category: string;
  readMinutes: number;
  /** ISO date, surfaced as "Updated …" and as the sitemap's lastmod. */
  updated: string;
  intro: string[];
  sections: GuideSection[];
}

export const GUIDES: Guide[] = [
  {
    slug: "optimize-your-steam-library",
    title: "How to optimize your Steam library",
    excerpt:
      "Cut a 900-game Steam account down to the dozen games you would actually enjoy finishing, and keep it that way.",
    category: "PC gaming",
    readMinutes: 7,
    updated: "2026-07-14",
    intro: [
      "A large Steam library is not a collection, it is a sediment. Bundles, sales, free weekends that stuck, gifts, and a hundred impulse buys at 80% off all settle into the same list, and the interface presents them as equals. The result is the familiar paralysis: nine hundred games, and you open the same three.",
      "Optimising a Steam library is not about deleting things. It is about separating the games you own from the games you are actually considering, so that the second list is short enough to choose from. Here is the process, and where a library manager does the parts Steam will not.",
    ],
    sections: [
      {
        heading: "Start by separating ownership from intent",
        paragraphs: [
          "Steam has exactly one concept: you own this. Everything else — categories, favourites, hidden — is a shallow layer painted on top, and none of it survives contact with a 900-game account because none of it is about what you plan to do.",
          "The first move is to give every game a status that describes intent, not ownership. Most people need fewer than seven: unsorted, wishlist, backlog, playing, finished, shelved, dropped. The important two are the ones people skip. 'Shelved' is for games you have paused but will return to. 'Dropped' is for games you are done with and are never going back to, and it is the single highest-value category in any backlog system, because it is the only one that makes the list shorter.",
          "Be ruthless with 'dropped'. A game you bounced off twice in four years is not a backlog item, it is a memory. Moving it out of the backlog does not delete it, and it is reversible — but until you do it, it is taking up one of the finite slots in your attention.",
        ],
        bullets: [
          "Unsorted is a staging area, not a resting place — empty it in passes",
          "Anything untouched for two years defaults to shelved or dropped",
          "Free bundle leftovers you never chose are almost always dropped",
          "Keep 'playing' to three games at most, or it stops meaning anything",
        ],
      },
      {
        heading: "Sort by time to beat, not by title",
        paragraphs: [
          "The reason a backlog feels immovable is that every game in it looks the same size. A 90-hour RPG and a 4-hour puzzle game sit side by side as identical tiles, so choosing between them means guessing at a commitment you cannot see.",
          "Attaching a time-to-beat figure to each game changes the question from 'what do I want to play?' — which is unanswerable at 11pm on a Tuesday — to 'what fits in the time I have?', which is trivially answerable. Sorting a backlog shortest-first is the single most effective change most people can make, because it surfaces the twenty games you could genuinely finish this month.",
          "Time-to-beat data comes in three flavours: main story, main plus extras, and completionist. Pick the one that matches how you actually play. Most people overestimate themselves here and set completionist, then wonder why nothing on the list ever looks achievable.",
        ],
      },
      {
        heading: "Let the import do the typing",
        paragraphs: [
          "Nobody categorises 900 games by hand, which is why most attempts at this die in week one. The import has to be automatic or the system never gets off the ground.",
          "Linking a Steam account pulls every owned game across with its playtime already attached, which does most of the sorting for you before you touch anything: a game with 40 hours on it is not in your backlog, and a game with zero hours that you bought four years ago is a strong dropped candidate. Achievement data adds a second signal — a game you are 70% through is a much better 'next up' than one you have never opened.",
          "Watch how matching is done. Titles are ambiguous — there are two well-known games called Deadlock, and half a dozen re-releases that differ only by a subtitle. Matching by Steam app id resolves those exactly; title matching does not. Anything the importer cannot resolve confidently should land in a review queue rather than silently picking one, because a wrong match quietly corrupts your library and you will not notice for months.",
        ],
        bullets: [
          "Import once, then use playtime as your first sorting pass",
          "Zero hours plus an old purchase date is the classic drop candidate",
          "Review ambiguous matches instead of trusting a title lookup",
          "Re-imports should dedupe, not duplicate, on app id",
        ],
      },
      {
        heading: "Keep storefronts separate from platforms",
        paragraphs: [
          "The other half of a PC library is that it is not all on Steam. Epic gave away several hundred games over the years, GOG holds the back catalogue, and Battle.net and EA App hold specific franchises hostage. Treating each as an unrelated island produces four small useless lists instead of one useful one.",
          "The fix is to treat storefronts as sub-platforms of PC rather than as siblings of it. A game filed under Steam is a PC game — it should count in your PC totals and appear when you filter for PC — while the badge on the card still tells you where to launch it. That way 'how many PC games do I own?' and 'where do I own this one?' are both answerable, and neither answer requires you to mentally union four lists.",
        ],
      },
      {
        heading: "Do a quarterly pass, not a permanent project",
        paragraphs: [
          "Library maintenance fails when it is framed as a one-time cleanup, because a Steam library is not a static object — a summer sale adds thirty games in a week. Framed instead as a recurring twenty-minute pass, it stays manageable indefinitely.",
          "A good pass has three steps: empty the unsorted staging area, demote anything in 'playing' you have not opened in a month, and drop one game you have been lying to yourself about. That last one is the point of the exercise. A backlog that only grows is a to-do list you will never finish; a backlog you actively prune is a menu.",
        ],
      },
    ],
  },
  {
    slug: "track-mission-progress",
    title: "Best ways to track mission progress",
    excerpt:
      "Why 'currently playing' tells you nothing, and how mission-level tracking turns a vague status into a real completion percentage.",
    category: "Progress tracking",
    readMinutes: 6,
    updated: "2026-07-22",
    intro: [
      "Most game trackers offer three states: not started, playing, finished. That vocabulary is fine for a four-hour indie and useless for a sixty-hour open-world game you last touched in March. 'Playing' covers everything from the tutorial to the final boss, which means it tells you nothing at the exact moment you need to know something — when you are deciding whether to pick a game back up.",
      "Mission-level tracking fixes that by recording where in the story you actually are. It takes slightly more effort per session and pays it back the first time you return to a game after two months.",
    ],
    sections: [
      {
        heading: "The problem with percentage-complete from the game itself",
        paragraphs: [
          "Plenty of games report their own completion percentage, and almost none of them mean the same thing by it. Some count collectibles, some weight side content equally with the main story, and some are measuring achievement unlocks rather than narrative progress. A game reporting 34% might be a third of the way through the story or two missions from the credits.",
          "Achievement percentages have the same problem in a different direction: they are excellent for completionist tracking and actively misleading for story progress, because the hardest achievements are usually orthogonal to finishing the game at all.",
          "A mission list sidesteps both. If a game has 51 story missions and you have done 12, you are 24% through the story — no interpretation required, and it compares meaningfully to the next game.",
        ],
      },
      {
        heading: "Build the list once, tick it forever",
        paragraphs: [
          "The obvious objection is that entering 51 mission names is worse than the problem it solves. It would be, if you had to type them. In practice there are three routes, in descending order of convenience.",
          "The first is importing a mission list from a community wiki. This works well for large games with well-maintained wikis and poorly for everything else — every wiki lays its mission pages out differently, so treat an import as a first draft to review rather than a finished list. A good importer prefers returning nothing to returning a wrong list; if it hands you a list of enemy names instead of missions, that is the failure mode to watch for.",
          "The second is pasting a list you found yourself. The third is typing chapter headings as you reach them, which sounds laborious but is about four words per session and produces the most accurate list of the three.",
        ],
        bullets: [
          "Wiki imports are best-effort — always review before trusting one",
          "Group missions into chapters; numbering should stay continuous across them",
          "Sequential mode lets ticking mission 12 fill in 1–11 in one action",
          "Unticking should clear only that entry, so a skipped mission stays a visible gap",
        ],
      },
      {
        heading: "Keep side content out of the main count",
        paragraphs: [
          "The fastest way to make mission tracking useless is to mix side quests into the story list. Side content is optional by definition, so including it means your completion percentage measures a target you never intended to hit, and 'time remaining' becomes a number you will never reach.",
          "Track them as a separate list, and leave that list untimed on purpose. How much side content you do is a choice you make per game and per mood, so any estimate attached to it is invented. A count — 6 of 40 side quests — is honest and useful; an estimate of '18 hours of side content remaining' is a fiction that makes the main estimate worse.",
        ],
      },
      {
        heading: "Turning progress into time remaining",
        paragraphs: [
          "Once you have a mission count and a time-to-beat figure, an estimate falls out of the arithmetic: divide the expected story length across the missions and multiply by what is left. Twelve of 51 missions in a 35-hour game means roughly 26 hours to go.",
          "Be clear-eyed about the accuracy. Real missions vary enormously — a five-minute drive to a waypoint and a forty-minute set piece count the same in this model, and no public data source gives per-mission timings. The estimate is a planning tool with a wide error bar, not a countdown. It is still dramatically better than the alternative, which is no number at all.",
          "Where it earns its keep is comparison. When four games are all sitting at 'playing', the one with six hours left and the one with fifty are very different propositions, and that is the decision the number is there to inform.",
        ],
      },
      {
        heading: "A workflow that survives contact with real life",
        paragraphs: [
          "The tracking habit that lasts is the one that costs a few seconds at a natural stopping point. Tick the mission you just finished when you put the controller down — not during play, and not in a weekly catch-up session you will abandon by the third week.",
          "If you return to a game and cannot remember where you were, the mission list is the answer by itself: the first unticked entry is where you stopped. That is the entire payoff, and it is why the habit is worth the few seconds.",
        ],
      },
    ],
  },
  {
    slug: "organize-your-game-backlog",
    title: "How to organize a game backlog you'll actually finish",
    excerpt:
      "A practical system for turning a 300-game pile of shame into a short, honest shortlist you can choose from tonight.",
    category: "Backlog",
    readMinutes: 8,
    updated: "2026-06-30",
    intro: [
      "The phrase 'pile of shame' is doing real damage. It frames an ordinary consequence of cheap games — owning more than you can play — as a personal failing, and guilt is a famously poor motivator for a hobby. A backlog is not a debt. It is a menu that has grown too long to read.",
      "What follows is a system for shortening the menu. It assumes you will never finish everything you own, and is designed around that fact rather than in denial of it.",
    ],
    sections: [
      {
        heading: "Accept the arithmetic first",
        paragraphs: [
          "Do the sum once, honestly. If you own 300 games averaging 20 hours each, that is 6,000 hours. At a fairly generous six hours of gaming a week, that is nineteen years — and you will keep buying games throughout. The backlog is not a queue that can be drained.",
          "This is liberating rather than depressing, because it kills the goal of 'finishing the backlog' and replaces it with a better one: making sure the games you do play are the ones you most wanted to play. Every organisational decision below follows from that.",
        ],
      },
      {
        heading: "Three lists, not one",
        paragraphs: [
          "Split what you own into three genuinely different things. Owned is everything, and it is a reference list you rarely look at. Backlog is games you have made an actual decision to play. Shortlist is the three to five you are choosing between right now.",
          "The mistake almost everyone makes is treating 'owned' and 'backlog' as synonyms. They are not: a game enters your backlog by a deliberate act, not by being purchased. This single distinction usually cuts the perceived size of the problem by 80%, because most of what you own you never actually intended to play soon.",
        ],
        bullets: [
          "Owned: everything, searchable, rarely browsed",
          "Backlog: you have decided to play these — keep it under 30",
          "Shortlist: three to five, the answer to 'what tonight?'",
          "Wishlist: not owned, and kept well away from the backlog",
        ],
      },
      {
        heading: "Sort by commitment, not by hype",
        paragraphs: [
          "Once the backlog is a real list, the ordering question matters. Sorting by release date favours whatever is newest, which is how games bought at launch stay unplayed forever. Sorting by rating favours the 100-hour epics, which are exactly the ones hardest to start.",
          "Sort by time to beat, ascending. Short games get finished, finishing games feels good, and feeling good is what keeps the system alive. Three eight-hour games completed in a month does more for your relationship with your backlog than forty hours into a sprawling RPG you abandon in act two.",
          "Keep one long game in progress alongside the short ones if you like — the point is not to ban ambitious games, it is to stop the list being nothing but them.",
        ],
      },
      {
        heading: "Make dropping a game a normal, low-drama action",
        paragraphs: [
          "Every backlog system needs an exit that is not 'finish it'. Without one the list only grows, and a list that only grows is one you eventually stop opening.",
          "Give yourself a rule and follow it mechanically. Two hours is the usual one: if a game has not given you a reason to continue in two hours, drop it. Not 'shelve it', not 'maybe later' — dropped, and out of the backlog. You bought the option to play it, and you exercised that option. That is the transaction completing, not failing.",
          "Keep dropped games visible rather than deleting them. Reviewing that list once a year is genuinely useful — tastes change, and a game you dropped in a bad week sometimes deserves a second run.",
        ],
      },
      {
        heading: "Use categories that describe you, not the industry",
        paragraphs: [
          "Built-in statuses cover the common path, but the useful organisational schemes are personal: 'couch co-op with my partner', 'games to play on the Steam Deck on trains', 'comfort replays', 'started before I had a kid'. These cut across genre and platform and are how people actually decide what to play.",
          "Custom categories earn their place when they answer a question you ask often. If you keep asking 'what can I play in 30-minute chunks?', that is a category. If you made one called 'atmospheric' and have not opened it since, it is decoration — delete it.",
        ],
      },
      {
        heading: "Review monthly, in twenty minutes",
        paragraphs: [
          "Put a recurring twenty minutes in the calendar. Promote a few games from owned into the backlog, demote anything in 'playing' you have not touched in a month, drop one game, and rebuild the shortlist.",
          "That is the whole maintenance burden. A system that needs more than this will be abandoned; a system that needs less is not doing anything. The output is a shortlist of three games you are genuinely excited about, which is the only artefact of the entire process that you use day to day.",
        ],
      },
    ],
  },
  {
    slug: "catalogue-physical-game-collection",
    title: "Cataloguing a physical game collection",
    excerpt:
      "Barcode scanning, box art, and how to record condition and completeness for a shelf of cartridges and discs.",
    category: "Collecting",
    readMinutes: 6,
    updated: "2026-07-02",
    intro: [
      "Digital libraries catalogue themselves. A shelf does not, and the gap between 'I own about forty Mega Drive games' and knowing exactly which forty is the difference between a collection and a pile of boxes — most obviously when you are standing in a second-hand shop wondering whether you already have this one.",
      "The good news is that cataloguing a physical shelf is a one-afternoon job if you approach it in the right order, and close to zero effort to maintain afterwards.",
    ],
    sections: [
      {
        heading: "Scan barcodes for anything made after about 1995",
        paragraphs: [
          "Retail barcodes resolve to a product listing, and a product listing usually contains the game's title and platform. Scanning is roughly four seconds per game against maybe thirty for typing and correcting a title, so start here and only fall back to manual entry for what fails.",
          "Retail listings are not clean titles, though, and this is where naive scanners fall over. A listing reads 'Pokemon Sun Nintendo 3DS 09109480' — a title, a publisher, a platform and an SKU run together. Stripping the platform and the long numeric SKU is essential; stripping publishers is not, because 'Nintendo Land' and 'Sega Bass Fishing' are real titles that lose their meaning if you do. The sane approach is to try it both ways and keep whichever scores better against a game database.",
          "Batch your scans. Scanning a shelf one game at a time with a confirmation dialog after each is miserable; queueing twenty and confirming once is the difference between finishing the shelf and giving up at game nine.",
        ],
        bullets: [
          "Expect pre-1995 cartridges to have no usable barcode — enter those by hand",
          "PAL and NTSC releases carry different barcodes for the same game",
          "Compilations and 'greatest hits' reprints often resolve to the wrong entry",
          "Check the platform the scan inferred before confirming a batch",
        ],
      },
      {
        heading: "Record format and completeness, because they are the collection",
        paragraphs: [
          "For digital games, ownership is binary. For physical ones it is a spectrum, and the spectrum is most of what makes a physical collection interesting: cartridge only, boxed, boxed with manual, sealed. A shelf of forty loose cartridges and a shelf of forty complete-in-box copies are very different collections that a plain owned-list records identically.",
          "Record this at entry time. Retrofitting completeness data across two hundred games later means handling every box again, and you will not do it.",
        ],
      },
      {
        heading: "Get real box art where it exists",
        paragraphs: [
          "Storefront cover images are made for storefronts: square or portrait crops of key art, usually with logos placed for a digital tile. They are wrong for a physical collection, where the thing you own is a specific regional box with a specific spine.",
          "Scan archives cover most retro platforms with genuine retail box fronts, and they are worth using — a shelf view built from real box scans is recognisably your shelf, which is the entire appeal. Modern platforms are patchier, and for those a synthesised case using the platform's standard livery is the honest fallback.",
          "Pay attention to dimensions. Retail cases are not all the same shape — an N64 box is landscape, a PS1 jewel case is nearly square, a DS case is a different ratio again — and rendering everything at one aspect ratio is what makes most virtual shelves look like a spreadsheet.",
        ],
      },
      {
        heading: "One catalogue, both halves of the collection",
        paragraphs: [
          "The final step is not keeping the physical catalogue separate. The question you actually ask is 'do I own this game?', not 'do I own this game on a disc?', and a system that answers only half of it sends you to check two places.",
          "File physical copies under the console they belong to, with the format recorded, in the same library as everything else. Then 'do I own Metroid Prime?' has one answer — yes, on GameCube, boxed, and also on Switch digitally — which is the answer you wanted both times.",
        ],
      },
    ],
  },
  {
    slug: "build-play-order-collections",
    title: "Building play-order collections for game series",
    excerpt:
      "Chronological, release order, or something else — how to lay out a marathon through a series and actually follow it.",
    category: "Collections",
    readMinutes: 5,
    updated: "2026-07-18",
    intro: [
      "Deciding to play through a series is easy. Deciding the order is where it stalls, because for most long-running series there is no single correct answer — release order, in-world chronology and 'what a new player should skip' are three different lists, and the internet will argue for all three.",
      "A play-order collection is how you settle it once, write it down, and stop relitigating the decision every time you finish an entry.",
    ],
    sections: [
      {
        heading: "Pick an ordering principle before you pick an order",
        paragraphs: [
          "Release order preserves the experience the developers built, including the technological leaps and the moments where a sequel answers its predecessor. It is almost always the right default for a first run through a series, and it ages badly only when the earliest entries are genuinely unplayable now.",
          "Chronological order suits series where the story is the point and the entries were made out of sequence. It works best when the series was designed with a coherent timeline rather than having one retrofitted, which is rarer than fans tend to claim.",
          "The third option — a curated path that skips entries — is the most useful and the least discussed. Most long series have two or three instalments that are safely skippable, and a marathon that acknowledges this is far more likely to be finished than one that dutifully includes every spin-off.",
        ],
      },
      {
        heading: "A branching graph beats a numbered list",
        paragraphs: [
          "Real play orders are not always linear. Two side entries might be interchangeable, a spin-off might be optional, and a prequel might work either before or after the entry it precedes. Flattening that into a single numbered list forces a false decision and hides the structure.",
          "Laying the collection out as a graph — nodes for games, links for 'play this after that' — records the shape as it really is. Two unlinked nodes at the same depth mean genuinely interchangeable; an unlinked optional node reads as exactly that.",
          "Keep the graph honest about status. Colour-coding the nodes by whether each game is finished, in progress, queued or not owned turns the collection into a progress view as well as a plan.",
        ],
        bullets: [
          "Link only real dependencies — over-linking invents constraints",
          "Optional entries belong in the graph, unlinked, not deleted from it",
          "Include games you don't own yet and flag them, so gaps are visible",
          "Roll up total hours so you know what you're committing to",
        ],
      },
      {
        heading: "Include games you don't own",
        paragraphs: [
          "This is the detail that decides whether a play-order collection is useful. 'The Zelda games in chronological order' is a reading list, and a reading list that silently omits the four entries you have not bought is not the list you asked for.",
          "A collection should be able to reference any game, with the ones you do not own flagged rather than hidden. That way the collection doubles as a shopping list, and the total-hours figure reflects the actual marathon rather than the portion you happen to have already.",
        ],
      },
      {
        heading: "Share it, and take a copy rather than a reference",
        paragraphs: [
          "Play orders are worth sharing — somebody has already thought hard about the best route through a series, and that work should not be repeated per person.",
          "The subtlety is what 'adopting' someone else's list should mean. A live reference sounds tidier but is wrong in practice: if the author rearranges their order while you are eight games into it, your marathon rearranges itself underneath you. A deep copy — games, positions and links, all duplicated — means your edits stay yours and theirs stay theirs, which is the behaviour everyone actually expects.",
          "A copy should also start private. Publishing someone else's list under your name is their call, not yours.",
        ],
      },
    ],
  },
  {
    slug: "import-your-collection-fast",
    title: "Importing a game collection without typing it in",
    excerpt:
      "Screenshot OCR, barcode batches and account sync — the three fastest routes from zero to a full library, and where each one fails.",
    category: "Getting started",
    readMinutes: 6,
    updated: "2026-07-26",
    intro: [
      "The reason most people's game-tracking attempts die in the first week is data entry. Typing three hundred titles is a chore nobody finishes, and a half-entered library is worse than none because you cannot trust it to answer anything.",
      "There are three ways to avoid the typing, and they cover different parts of a collection. Used together, most people can get a full library in under an hour.",
    ],
    sections: [
      {
        heading: "Account sync handles the digital bulk",
        paragraphs: [
          "If most of your collection is on a PC storefront, linking the account is the whole job. Steam's API exposes owned games with playtime, which imports the list and pre-sorts it in one action — playtime alone tells you what you have finished, what you bounced off, and what you never opened.",
          "The important quality bar here is match accuracy. Matching by app id is exact; matching by title is a guess that goes wrong on re-releases, remasters and the surprisingly common case of two unrelated games sharing a name. Anything that cannot be matched exactly should go to a review queue rather than being auto-added, and a re-import later should recognise what it already brought in rather than duplicating it.",
        ],
      },
      {
        heading: "Screenshot OCR covers the launchers with no API",
        paragraphs: [
          "Several storefronts have no usable public API. For those, a screenshot of the launcher's library view is the fastest route: read the titles off the image and match them.",
          "OCR on launcher screenshots is easier than it sounds because the text is rendered, not photographed — clean, high-contrast and consistently sized. The hard part is not reading the characters, it is knowing which characters are a game. A launcher screenshot is full of chrome: 'Update Queued', 'Install', playtime figures, filter labels, trademark symbols and icon fragments that OCR renders as junk prefixes.",
          "So the filtering matters more than the recognition. Expect a good pipeline to strip launcher furniture, drop leading icon noise, and correct the small set of predictable OCR confusions — roman numerals rendered as 'il' or 'Hl' being the classic. Then it should score each match and show you the score.",
        ],
        bullets: [
          "Launcher screenshots: reliable, and the best case for OCR",
          "Shelf photos: much harder — spines are low-contrast and often vertical",
          "Anything under about 85% confidence should require confirmation",
          "A re-search box on each row matters more than raw accuracy",
        ],
      },
      {
        heading: "Barcodes cover the shelf",
        paragraphs: [
          "Physical games have the advantage of a machine-readable identifier printed on the box. Scanning is fast enough that a shelf of fifty is a twenty-minute job, provided the scanner batches — queueing scans and confirming once at the end, rather than a dialog per game.",
          "Two caveats. Barcodes resolve to retail product listings, which need cleaning before they are game titles: SKUs, edition words and platform names all have to come off. And lookups usually run against a rate-limited third-party database, so scanning a very large collection can hit a daily cap.",
        ],
      },
      {
        heading: "Confirm everything, and never let an import write silently",
        paragraphs: [
          "The one rule that ties all three routes together: nothing should enter your library without you seeing it. Every import method here has a failure mode that produces plausible-looking wrong data — a title match to the wrong sequel, an OCR read that turns 'BONELAB' into something unrecognisable, a barcode that resolves to a compilation.",
          "A review step catches all of these in a couple of minutes, and its absence is what makes an auto-imported library quietly untrustworthy. Confidence scores, a re-search box, and a bulk confirm are the three things that make the review fast enough that you will actually do it.",
        ],
      },
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

/** Word count across a guide's prose — used for the "N-minute read" sanity. */
export function guideWordCount(guide: Guide): number {
  const text = [
    guide.intro.join(" "),
    ...guide.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? [])]),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}
