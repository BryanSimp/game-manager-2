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
          "The first is taking a list someone else has already published for that game and saving your own copy of it. Your copy is yours — edit it, reorder it, tick it off — and the original is untouched by anything you do. Automated scraping of community wikis sounds like the obvious fourth route and isn't: every wiki lays its mission pages out differently, and an importer that is right two games in six produces lists of enemy names you then have to unpick.",
          "The second is pasting a list you found yourself, one mission per line. The third is typing chapter headings as you reach them, which sounds laborious but is about four words per session and produces the most accurate list of the three.",
        ],
        bullets: [
          "A copied list is a private copy — edits never reach the original",
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
      "Barcode scanning, cover art, and how to record a shelf of cartridges and discs alongside your digital library.",
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
          "For digital games, ownership is binary. For physical ones it is a spectrum — cartridge only, boxed, boxed with manual, sealed — and a shelf of forty loose cartridges is a very different collection from forty complete-in-box copies. Game Manager records the half of that which changes what you can do with a game: physical or digital, per platform. Grading beyond that is a note on the game, at least for now.",
          "Whatever you record, record it at entry time. Retrofitting condition data across two hundred games later means handling every box again, and you will not do it.",
        ],
      },
      {
        heading: "Fix the cover art you don't recognise",
        paragraphs: [
          "Automatic cover art comes from storefronts, and storefront art is made for storefronts: a crop of the key art, with the logo placed for a digital tile. For a retro game it is often the wrong region's art entirely, and for an obscure one there may be none at all.",
          "This matters more than it sounds, because a library is scanned visually. You do not read four hundred titles — you look for the box you remember owning, and a wall of wrong or missing art turns a two-second glance into a search.",
          "Both fixes are quick. Browse for an alternate cover and pick the one that matches the copy on your shelf, or upload your own image — a photograph of the actual box works, and for a collection where the specific edition matters it is better than anything a database will hand you.",
        ],
      },
      {
        heading: "One catalogue, both halves of the collection",
        paragraphs: [
          "The final step is not keeping the physical catalogue separate. The question you actually ask is 'do I own this game?', not 'do I own this game on a disc?', and a system that answers only half of it sends you to check two places.",
          "File physical copies under the console they belong to, marked physical rather than digital, in the same library as everything else. Then 'do I own Metroid Prime?' has one answer — yes, a disc for the GameCube, and also digitally on Switch — which is the answer you wanted both times.",
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
  {
    slug: "zelda-games-in-order",
    title: "What order to play the Zelda games",
    excerpt:
      "Release order, Nintendo's official timeline, and the order that actually makes sense for someone starting now.",
    category: "Play order",
    readMinutes: 9,
    updated: "2026-08-16",
    intro: [
      "Two different questions get asked as one here. 'What order did the Zelda games come out?' has a flat factual answer. 'What order does the story happen in?' has an official answer that Nintendo published in 2011 and has been quietly amending ever since. Neither is the order most people should actually play them in.",
      "The reason is that Zelda is not a serial. Almost every game is a fresh Hyrule with a fresh Link, and the connective tissue between them is thematic — a sword, a name, a recurring villain — rather than narrative. You are not going to be lost. What you can be is bored, and that is the real risk when someone starts at the 1986 original out of a sense of duty.",
    ],
    sections: [
      {
        heading: "The short answer: start with a good one, not the first one",
        paragraphs: [
          "Pick an entry point that matches the kind of game you want, play it, and let it tell you whether you want more. Four of them work as a first Zelda, and they are very different from each other.",
          "Breath of the Wild is the one to start with if you want the modern open-world version of the series and have never played any of them. Tears of the Kingdom is its direct sequel and is better in almost every measurable way, but it assumes you have spent eighty hours in that map already, so playing it first spends a lot of goodwill you have not banked yet.",
          "A Link to the Past is the one to start with if you want the classic top-down formula at its tightest. It is thirty-odd years old and has aged remarkably well, largely because it was already the refined version of what the first two games were reaching for.",
          "Ocarina of Time is the historically important one, and it is still good, but it is the entry most likely to feel its age in the moment-to-moment — the camera and the pacing of its opening hours are of their era. Play it because you want to see the hinge the whole series turns on, not because you feel you have to.",
          "Link's Awakening is the smallest and strangest, and the 2019 remake makes it the easiest to recommend outright: about twelve hours, self-contained, and it has nothing to do with the timeline at all.",
        ],
        bullets: [
          "Want a big open world → Breath of the Wild",
          "Want a classic dungeon crawl → A Link to the Past",
          "Want the historically important one → Ocarina of Time",
          "Want something short → Link's Awakening",
        ],
      },
      {
        heading: "Why chronological order is a trap",
        paragraphs: [
          "Nintendo's official timeline splits into three branches after Ocarina of Time, on the basis that its time-travel ending produces more than one outcome. That is a fun piece of lore and a terrible instruction manual. Playing chronologically means starting with Skyward Sword, which is the earliest story but was released in 2011, has the most divisive controls in the series, and opens with several hours of tutorial.",
          "It also means bouncing between hardware generations constantly. Chronological order will send you from a 2011 Wii game to a 2000 Nintendo 64 game to a 2006 GameCube game inside the first three entries. Every one of those transitions costs you a re-acclimatisation you did not need to pay for.",
          "The deeper problem is that the timeline was assembled after the fact. These games were not written as a continuous story and it shows the moment you try to play them as one. Treat it as trivia you enjoy after the fact rather than a route.",
        ],
      },
      {
        heading: "The sequels that genuinely are sequels",
        paragraphs: [
          "There is a short list of games where order really does matter, because they are direct continuations with returning characters and a world that assumes you were there. These are worth respecting even if you ignore everything else.",
          "Everything not on this list can be played in essentially any order without confusion.",
        ],
        bullets: [
          "Majora's Mask follows Ocarina of Time — same Link, immediately after",
          "Tears of the Kingdom follows Breath of the Wild — same map, same Link",
          "Phantom Hourglass follows The Wind Waker, and Spirit Tracks follows Phantom Hourglass",
          "Zelda II: The Adventure of Link follows the original, and is the odd one out in the whole series",
        ],
      },
      {
        heading: "Nintendo's timeline, briefly",
        paragraphs: [
          "If you want the lore version: Skyward Sword is first, followed by The Minish Cap and Four Swords, then Ocarina of Time. Ocarina then splits the series into three.",
          "The Child Era continues with Majora's Mask and Twilight Princess. The Adult Era continues with The Wind Waker, Phantom Hourglass and Spirit Tracks. The third branch — the one where Link loses — runs A Link to the Past, the Oracle games, Link's Awakening, then the original Legend of Zelda and Zelda II.",
          "Breath of the Wild and Tears of the Kingdom sit thousands of years after all of it, deliberately far enough out that the branch question stops mattering. Nintendo has been fairly explicit that pinning them precisely is not the point.",
        ],
      },
      {
        heading: "A route that actually works",
        paragraphs: [
          "If you want a single recommended run rather than a decision tree, this one front-loads the games most likely to keep you going and puts the historically interesting but rougher entries later, once you have enough affection for the series to meet them halfway.",
          "Stop whenever you like. This is a series where finishing four entries and moving on is a perfectly good outcome, and treating it as a completionist obligation is how people end up resenting a hobby.",
        ],
        bullets: [
          "1. Breath of the Wild — the modern entry point",
          "2. Tears of the Kingdom — its direct sequel, once the map means something to you",
          "3. A Link to the Past — the classic formula, still sharp",
          "4. Link's Awakening — short, strange, self-contained",
          "5. Ocarina of Time — the hinge the series turns on",
          "6. Majora's Mask — only after Ocarina, and much better for it",
          "7. The Wind Waker — the one whose art style outlived every argument about it",
          "8. Twilight Princess, then anything left that appeals",
        ],
      },
      {
        heading: "Keeping track of a run this long",
        paragraphs: [
          "Nineteen mainline games across nine consoles is exactly the kind of list that gets lost in a notes app. The useful thing to record is not just which ones you have finished but which order you decided on and why, because that decision is the part you will forget by the third entry.",
          "A play-order collection handles this better than a flat list: the run is an ordered sequence you set once, each game carries its own status, and the branch points — 'play Majora's only after Ocarina' — are visible as structure rather than as a comment you left yourself. It also survives the gap. Series runs this long are usually measured in years, not weeks, and the thing you actually need in month eight is a reminder of where you were.",
        ],
      },
    ],
  },
  {
    slug: "mass-effect-play-order",
    title: "Mass Effect in order, and what carries over",
    excerpt:
      "The trilogy is one continuous save with decisions that persist across all three games. Here is what transfers, and where Andromeda fits.",
    category: "Play order",
    readMinutes: 7,
    updated: "2026-08-14",
    intro: [
      "Mass Effect is the rare series where play order is not a matter of taste. The original trilogy is one story told across three games, with a save file that carries your decisions forward — including which characters are alive to appear in the next one. Playing it out of order does not just spoil things, it removes the entire mechanism the series is built around.",
      "So the order is settled. What is worth knowing is what actually transfers, what happens if you skip an entry, and whether the two games outside the trilogy are worth your time.",
    ],
    sections: [
      {
        heading: "The order",
        paragraphs: [
          "Mass Effect, Mass Effect 2, Mass Effect 3, in that order, all three of them, ideally with the same imported save. The Legendary Edition packages the trilogy with its DLC and brings the first game's combat and interface close enough to the later two that the transition no longer feels like a punishment — which was, for years, the main reason people bounced off at the start.",
          "Andromeda is a separate story in a different galaxy with a different cast. It is not a sequel in any meaningful sense and can be played whenever, or not at all. Play it after the trilogy if you play it, because a lot of what it does only reads as interesting against what came before.",
        ],
      },
      {
        heading: "What actually carries over",
        paragraphs: [
          "The save import is the point of the series, and it is more thorough than people expect. Decisions from your first playthrough surface in the second and third games as characters who appear or do not, as factions that help or refuse, and occasionally as a single line of dialogue acknowledging something you did forty hours earlier.",
          "The most consequential piece is that squadmates can die permanently, and the game does not stop you. A character killed in the first game is simply absent from the rest of the trilogy, and their role gets filled by someone else or by nobody. Mass Effect 2's ending in particular can lose you most of the cast if you go into it unprepared, and those losses propagate straight into the third game.",
          "Starting a later game fresh instead of importing gives you a generic default history — a set of decisions someone else made. Everything technically works, but the series stops being about your Shepard, which is the only thing it is really selling.",
        ],
        bullets: [
          "Squadmate deaths are permanent and carry across every subsequent game",
          "Major faction and character decisions resurface, sometimes many hours later",
          "Your Shepard's appearance, class and background import too",
          "A fresh start substitutes a default history, which is the one genuinely lossy option",
        ],
      },
      {
        heading: "If you only have time for one",
        paragraphs: [
          "Mass Effect 2 is the best individual game of the three and it is the usual answer to 'which one is the good one'. It is also the one that depends most heavily on you caring about people you met in the first game, and its ending is built to punish a player who has not been paying attention to relationships built across two games.",
          "So the honest answer is that there is no good single entry point. If you genuinely only want one game, play the second and accept you are getting perhaps sixty per cent of it. If you want the series, start at the beginning — the Legendary Edition removed most of the reason not to.",
        ],
      },
      {
        heading: "Budgeting the run",
        paragraphs: [
          "The trilogy is roughly 30, 35 and 40 hours on a main-story run, and comfortably half again as much if you do the side content — which in this series is where most of the character writing lives, so skipping it to save time is a false economy.",
          "That puts a full trilogy run somewhere between 100 and 160 hours. It is worth knowing that number before you start rather than discovering it in the middle of game two, because the most common failure mode is stalling out partway through the third game, which is exactly the point where the previous hundred hours were supposed to pay off.",
        ],
      },
    ],
  },
  {
    slug: "final-fantasy-where-to-start",
    title: "Where to start with Final Fantasy",
    excerpt:
      "The numbered games are standalone, so the question is not order but which one suits you. A guide to picking an entry point.",
    category: "Play order",
    readMinutes: 8,
    updated: "2026-08-12",
    intro: [
      "Final Fantasy is not a series in the way most series are. The numbered entries share a handful of recurring motifs — crystals, chocobos, a character called Cid — and essentially nothing else. Different worlds, different casts, different combat systems, sometimes radically different genres.",
      "This means there is no play order, and asking for one is asking the wrong question. What you actually want is to pick the entry point that suits what you want out of a game, because the gap between two Final Fantasy games can be wider than the gap between two unrelated series.",
    ],
    sections: [
      {
        heading: "The exceptions to 'they are all standalone'",
        paragraphs: [
          "A short list of games are direct sequels and do assume the original. Everything else can be started cold.",
          "The remake project is the one that catches people out. Final Fantasy VII Remake and Rebirth are a multi-part retelling of the 1997 game, and they are in continuity with each other — Rebirth expects you to have played Remake. They are also, deliberately, not a straight retelling, which is a much more interesting experience if you know the original but works fine if you do not.",
        ],
        bullets: [
          "X-2 follows X directly",
          "XIII-2 and Lightning Returns follow XIII",
          "VII Rebirth follows VII Remake",
          "Everything numbered otherwise is a clean start",
        ],
      },
      {
        heading: "Picking by what you want",
        paragraphs: [
          "The most reliable way to choose is by combat system and tone, because that is what actually differs. Turn-based and menu-driven is a fundamentally different hobby from real-time action, and the series contains both under the same name.",
          "If you want classic turn-based, VI and IX are the two strongest recommendations. VI has the best ensemble cast in the series and a mid-game structural turn that still holds up. IX is the warmest and most deliberately traditional, and is the one people who grew up with the series tend to name when pushed.",
          "If you want modern action combat, XVI is a full action game with light role-playing elements, and VII Remake sits in between with a hybrid that pauses for menu commands. XV is the open-road one, uneven but with a specific charm that nothing else in the series has.",
          "If you want the one that everyone has an opinion about, that is VII — either the 1997 original or the remake project, and both are defensible starting points for different reasons.",
          "If you want a game you will still be playing in two years, XIV is an MMO with a story that people finish and then talk about for a decade. It is also the single largest time commitment on this list by a wide margin.",
        ],
        bullets: [
          "Classic turn-based → VI or IX",
          "Modern action → XVI",
          "The famous one → VII, original or Remake",
          "Something with a road trip → XV",
          "An ongoing world → XIV",
        ],
      },
      {
        heading: "The ones not to start with",
        paragraphs: [
          "The first three games are historically interesting and mechanically thin by modern standards; they are worth playing after you like the series, not before. II in particular has a stat progression system that is famously unintuitive and will teach you the wrong lessons about what these games are.",
          "XIII is the other common trap. It is not a bad game, but it is linear for roughly its first twenty hours in a way that reads as broken if it is your first exposure, and its combat only opens up once it has stopped being restrictive. People who love XIII almost universally played something else first.",
        ],
      },
      {
        heading: "How long these actually take",
        paragraphs: [
          "Main-story runs cluster around 35 to 50 hours for most numbered entries, with completionist runs frequently doubling that. XII and XV go longer, and XIV is not measurable in the same units at all.",
          "That figure is the one worth checking before you start rather than after. The most common way a Final Fantasy run dies is picking the entry with the most name recognition rather than the one that fits the time available, stalling at hour twenty-five, and concluding the series is not for you — when the actual problem was that a different entry would have suited better.",
        ],
      },
    ],
  },
  {
    slug: "metal-gear-solid-play-order",
    title: "Metal Gear Solid in order: release or chronological",
    excerpt:
      "Chronological order spoils the twists the series is built on. Release order is the right answer, and here is the exception worth knowing.",
    category: "Play order",
    readMinutes: 7,
    updated: "2026-08-10",
    intro: [
      "Metal Gear is the series where the chronological-versus-release argument has a clear winner, and it is not close. The games are built around revelations about who characters are and what happened before, and the prequels were written for an audience that already had the later games' information. Play them first and you are reading the punchline before the joke.",
      "So: release order. The useful part of this guide is which games are actually mainline, where the prequels fit, and the one reasonable exception to the rule.",
    ],
    sections: [
      {
        heading: "Release order, with the mainline games only",
        paragraphs: [
          "The core sequence is Metal Gear Solid, Sons of Liberty, Snake Eater, Guns of the Patriots, then Peace Walker and The Phantom Pain. That is the spine, and playing it in that order is the default recommendation for anyone.",
          "The two MSX games that precede Metal Gear Solid — the original Metal Gear and Metal Gear 2: Solid Snake — are genuinely worth playing and are included in the Master Collection, but they are optional in a way the rest are not. Metal Gear Solid was designed as an entry point and recaps what you need.",
          "Ground Zeroes is a short prologue to The Phantom Pain rather than a game in its own right; play it immediately before, not as a separate thing.",
        ],
        bullets: [
          "Metal Gear Solid (1998)",
          "Metal Gear Solid 2: Sons of Liberty",
          "Metal Gear Solid 3: Snake Eater",
          "Metal Gear Solid 4: Guns of the Patriots",
          "Peace Walker, then Ground Zeroes, then The Phantom Pain",
        ],
      },
      {
        heading: "Why chronological order breaks the series",
        paragraphs: [
          "Chronologically, Snake Eater is first — it is set in 1964 and is a prequel about a character whose significance depends entirely on games released before it. Its ending lands as one of the best in the medium if you have played the earlier-released games, and as a mildly confusing spy story if you have not.",
          "The same problem repeats at every prequel. Peace Walker and The Phantom Pain are both built on the assumption that you know how this ends, and much of their tension comes from watching a character become someone you have already met. Reordering them removes the tension entirely and replaces it with nothing.",
          "Sons of Liberty makes the point most sharply: its whole structure is a deliberate manipulation of an audience that has played the first game and expects a particular thing. There is no version of playing it out of order that preserves what it is doing.",
        ],
      },
      {
        heading: "The one reasonable exception",
        paragraphs: [
          "If you have tried Metal Gear Solid and bounced off the 1998 controls — which is a real and common outcome — starting with Snake Eater is defensible. It is the most approachable of the older games, its story is self-contained enough to work cold, and it is the entry most likely to convince you the series is worth the friction.",
          "You will lose some of its ending. That is a genuine cost, and it is still better than not playing any of them. Go back to Metal Gear Solid afterwards; it reads differently in that direction, but it reads.",
        ],
      },
      {
        heading: "What counts as mainline",
        paragraphs: [
          "The series has a long tail of spin-offs — the Acid card games, Portable Ops, Rising, Survive — and none of them are required. Rising is a good action game with almost no bearing on the story. Portable Ops sits awkwardly between Snake Eater and Peace Walker and is the only one with a real argument for inclusion, though Peace Walker covers enough of its ground that skipping it costs little.",
          "This matters more than it sounds, because 'play the Metal Gear series' can mean eight games or fifteen depending on who is counting, and starting a run without deciding which is a good way to stall out somewhere around the card game.",
        ],
      },
    ],
  },
  {
    slug: "assassins-creed-play-order",
    title: "Assassin's Creed: which ones actually connect",
    excerpt:
      "Twelve-plus mainline games, one continuous framing story, and a hard split in the middle. What to play and what to skip.",
    category: "Play order",
    readMinutes: 8,
    updated: "2026-08-11",
    intro: [
      "Assassin's Creed is two series wearing the same name. The first runs from 2007 to about 2012 and is a serialised story with a continuous modern-day frame. The second, starting with Origins in 2017, is a set of large open-world role-playing games that are essentially standalone.",
      "Knowing where the split falls is most of what you need. It is the difference between a run that requires order and a run where you can pick whichever historical setting appeals and start there.",
    ],
    sections: [
      {
        heading: "The first arc genuinely is serialised",
        paragraphs: [
          "Assassin's Creed, II, Brotherhood, Revelations and III form one story with a single modern-day protagonist and a plot that continues directly between entries. Brotherhood and Revelations in particular are direct continuations of II with the same lead — they were not conceived as a trilogy but they function as one.",
          "Play these in release order or not at all. Starting at Brotherhood means starting mid-sentence, and the modern-day framing that ties them together is the part that makes the least sense out of sequence.",
          "The first game is the weakest and the most repetitive, and it is also the one that sets up everything. If you are going to play the arc, play it; if the repetition is going to stop you, start at II and accept some early confusion. II is where the series actually became good.",
        ],
        bullets: [
          "Assassin's Creed (2007) — sets up the frame, mechanically thin",
          "Assassin's Creed II — the one where it works",
          "Brotherhood and Revelations — direct continuations of II",
          "Assassin's Creed III — closes the modern-day arc",
        ],
      },
      {
        heading: "Black Flag is the exception everyone recommends",
        paragraphs: [
          "Black Flag is nominally the fourth in that line and is in practice a pirate game with an Assassin's Creed frame bolted on. It is the entry most often recommended to people who have never played any of them, and it works cold — the naval sailing that everyone remembers has nothing to do with the ongoing plot.",
          "It is a good starting point precisely because it does not commit you to anything. Rogue, Unity and Syndicate follow in the same broad era of the series and are all optional; Unity in particular is worth knowing had a famously rough launch and is much better now than its reputation.",
        ],
      },
      {
        heading: "The modern trilogy is standalone",
        paragraphs: [
          "Origins, Odyssey and Valhalla are large open-world role-playing games sharing a systems framework rather than a plot. Origins is set in Ptolemaic Egypt, Odyssey in Peloponnesian War Greece, Valhalla in ninth-century England. Any of them is a valid first Assassin's Creed.",
          "There is a loose chronological relationship — Odyssey is set earliest despite being released second — and a thin thread of connective lore, but none of it constrains order. Pick the setting you find most interesting and start there.",
          "The one thing to know before starting any of them is scale. These are 40 to 60 hour games on a main-story run and well past 100 if you engage with the map, and they are structurally similar enough that playing them back to back is the fastest way to burn out on the series entirely. Space them.",
        ],
        bullets: [
          "Origins — Egypt, the tightest of the three",
          "Odyssey — Greece, the largest and most role-playing-forward",
          "Valhalla — England, the longest by some distance",
          "Play one, then play something else before the next",
        ],
      },
      {
        heading: "A workable route",
        paragraphs: [
          "For most people the honest recommendation is not to play all of them. Twelve mainline games across eighteen years, several of which are near-identical in structure, is a recipe for resenting a series you started out enjoying.",
          "Play the II–Brotherhood–Revelations run for the serialised story at its best. Play Black Flag because it is the best individual game with the name on it. Play whichever of the modern trilogy has the setting you like most. That is five games, it covers everything the series is actually good at, and it leaves you the option of more rather than the obligation.",
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
