# Game Manager 2 — Context for Claude Code sessions

Self-hosted game library manager: web app + Expo mobile app sharing one API and one
account system. This is the **v2 rewrite** of the v1 app at `C:\My_Documents\Game Manager`
(Next.js 14 + SQLite, still running at games.brysimp.com). **[PLAN.md](PLAN.md) is the
source of truth** for the feature list, architecture rationale, data model, and the
Phase 0–8 roadmap — read it before making design decisions.

## Stack (decided — don't relitigate)

- **Monorepo**: pnpm workspaces + Turborepo. `.npmrc` uses `node-linker=hoisted` (required by Expo/Metro).
- **apps/api**: Fastify 5 + Drizzle ORM + PostgreSQL 16 + better-auth. Runs via `tsx` (no build step).
- **apps/web**: Vite + React 19 + TanStack Router (code-based routes in `main.tsx`, not file-based) + TanStack Query + Tailwind v4. Dark zinc/indigo theme.
- **apps/mobile**: **Expo SDK 54 — pinned, do not upgrade.** Bryan's iPhone runs the
  SDK 54 build of Expo Go (the App Store version on his iOS hasn't updated), so the
  project must stay on SDK 54 until his Expo Go updates. Expo Router (`src/app/`),
  plain StyleSheet (no NativeWind). Note SDK 54 API differences: navigation themes
  import from `@react-navigation/native` (not re-exported by expo-router v6).
- **packages/shared**: Zod schemas + TS types, exported as TS source (`./src/index.ts`), consumers transpile.
- **packages/api-client**: typed fetch wrapper. Web uses same-origin cookies; mobile attaches the better-auth session cookie from SecureStore via `getHeaders`.
- **Jobs**: pg-boss (rides on the same Postgres, in-process worker started in `apps/api/src/index.ts`).
- Versions pinned by better-auth 1.6 peers: **zod ^4**, **drizzle-orm ^0.45**.
- Mobile versions pinned by the Expo SDK 54 requirement (see apps/mobile above):
  react 19.1, react-native 0.81, expo-router ~6, expo-camera ~17. `expo install --fix`
  realigns them if they drift.
- **React must be the same exact version in every workspace package** (web is pinned
  to 19.1.0 to match Expo). If web and mobile diverge, pnpm's hoisted linker nests a
  second react under better-auth/use-sync-external-store and the native app crashes
  with "Invalid hook call". Also beware stale lockfile peer graphs after Expo SDK
  changes: apps/api's `@better-auth/expo` keeps old expo/react peer pins until you
  `pnpm remove` + re-`add` it (symptom: react-native 0.86 entries linger in the lock).

## Key architecture decisions & why

- **Shared catalog vs per-user state**: `games` (one row per real-world game, keyed by
  `igdb_id`) is shared by all users; `user_games` holds per-user status/rating/notes.
  Carried over from v1 — its best idea.
- **Auth**: better-auth mounted at `/api/auth/*` (Fastify request→fetch translation in
  `server.ts`). Web = HTTP-only cookies (same origin via Vite proxy in dev, Traefik path
  routing in prod → no CORS). Mobile = `@better-auth/expo` with SecureStore. First
  registered user becomes admin (databaseHook in `auth.ts`). Registration toggled by
  `ALLOW_REGISTRATION`.
- **Categories** (was "statuses pinned to five"): seven built-ins in
  `BUILTIN_CATEGORIES` (`packages/shared/src/constants.ts`) — uncategorized,
  wishlist, backlog, playing, finished, shelved, dropped — **plus per-user
  `custom_categories`**. `user_games.status` is therefore **text**, not the old
  pg enum: it holds a built-in key or a custom category's *id* (id, so renaming
  a category doesn't rewrite game rows). Every write validates via
  `isValidCategory`, which also scopes custom ids to their owner. Deleting a
  custom category moves its games to `uncategorized` rather than orphaning them.
  `uncategorized` is a real value, not a null column — nullable status would
  have rippled through every filter, dashboard and shelf query; it renders as
  *no* badge. The `game_status` pg type still exists but backs nothing.
- **IGDB**: server-side only (`services/igdb.ts`), Twitch client-credentials token cached
  in memory, ~3 req/s throttle queue. Credentials resolve **DB settings table first, env
  fallback** (v1 pattern) — admin pastes them into web Settings. Every fetched game is
  upserted into the local catalog; covers download in the background to `/data/images`
  (`games.cover_url` kept as remote fallback).
- **OCR import**: server-side pipeline (upload → pg-boss job → OCR → noise filter →
  match → review). Providers pluggable (`services/ocr.ts`): tesseract.js (local, fine
  for launcher screenshots) and Claude vision (`ANTHROPIC_API_KEY`; shelf photos
  auto-upgrade to it). Nothing enters the library without user confirmation — the review
  step is the safety net for bad OCR.
- **Noise filter** (`services/noise-filter.ts`): ported from v1 and hardened against a
  real Steam screenshot — strips launcher lines ("Update Queued"), ™ symbols, leading
  icon junk ("[PY Among us" → "Among us"), fixes roman-numeral misreads (il/Hl → III).
  The matcher (`services/matcher.ts`) retries weak matches without the junk first token
  and with an i→l OCR-confusion variant, keeping whichever scores higher
  (Dice bigram similarity = confidence).
- **Consoles, not a shelf** (replaced the virtual shelf in Phase 11): `user_consoles`
  is the list of consoles/storefronts a user owns, and it *is* the platform picker
  everywhere. `rememberConsoles()` (`services/consoles.ts`) is called by every path
  that files a game under a platform — game detail, quick add, bulk edit, Steam
  import, the default-platform preference — so the list can never drift from what
  games actually claim. Deleting a console therefore also unfiles its games
  (`removedFromGames` is returned so the UI can say so). Platform metadata
  (`release_date`, `summary`) is curated in `apps/api/scripts/seed.ts`; IGDB fills
  in `logo_url`, and a summary only where the seed left one blank, lazily on first
  view (`meta_fetched_at` stamps the attempt so misses aren't retried).
- **PC storefronts are sub-platforms of PC**, via `platforms.parent_platform_id`
  (one level deep — nobody needs a store inside a store). Steam, Epic, GOG,
  Battle.net, Origin, EA App, Ubisoft Connect, Xbox / Microsoft Store and
  itch.io are children of **PC**, which stays selectable on its own for "where
  I bought it doesn't matter". A game filed under Steam **is** a PC game:
  anything that counts or filters by platform rolls children into their parent
  (the library's `PC (all)` option, the consoles page's `storefrontCount`,
  `/console/$platformId`), while badges show the specific store. Owning a store
  implies owning its parent — `rememberConsoles()` adds both via `withParents()`.
  Steam imports file under **Steam**, matched by name because storefronts have
  no IGDB platform id; migration 0013 moves pre-existing PC ownership of any
  game with a `steam_app_id` onto Steam.
- **Console art is per-user** (`user_consoles.custom_image_id`, image kind
  `console_logo`): platforms are shared rows, so one person's uploaded Steam
  logo can't be everyone's. Falls back to the IGDB logo, then the abbreviation.
  Browsable as well as uploadable (`services/console-art.ts`): IGDB platform +
  hardware-revision logos first, then Wikimedia Commons, whose files are
  freely licensed and cover the storefronts IGDB doesn't model. Commons is a
  text search, so `ART_QUERIES` disambiguates names that are ordinary English
  words ("Steam logo" alone returns locomotives) and results are ranked by
  title before being cut to 12.
- **Steam matching goes by appid, not title** (`findIgdbGameBySteamAppId`):
  IGDB's `external_games` maps a Steam appid straight to a game, which is the
  only thing that separates two games called "Deadlock". Title matching (plus
  a release-year tiebreak from the store API, capped per run) is the fallback
  when IGDB has no mapping. On top of that, `steam_import_rules` is the manual
  last word per user: `block` keeps an app out for good, `map` pins it to a
  game — set from the game's page ("Wrong game?"), reviewed in the Steam card.
- **jsonb only for display config** (dashboard layout, status colors) — everything else
  that v1 stored as JSON strings is normalized tables here.
- **Security hardening** (pre-deployment pass): every stored image — uploaded
  *or* fetched from an allowlisted host — goes through
  `services/image-pipeline.ts`: magic-byte sniff (PNG/JPEG/WebP/AVIF; the
  client's mimetype header is never consulted), full re-encode through
  `sharp` (strips EXIF/GPS, destroys polyglot files, `rotate()` first so
  phone photos keep their orientation), 8192² pixel cap against
  decompression bombs; AVIF re-encodes to JPEG (AVIF encode is seconds of
  CPU). Upload limit is 5MB (multipart), remote fetches capped at 20MB —
  filenames were already the DB row's uuid. `plugins/sanitize.ts` is a global
  preValidation hook stripping *active* HTML only (script/iframe blocks,
  `on*=` handlers, `javascript:` URIs) from body/query strings — plain text
  like "boss < 50% hp" must survive, and `/api/auth/*` is skipped because
  altering a password silently breaks the account (React escaping remains
  the primary XSS defense; this keeps payloads out of the DB for future
  non-escaping consumers). `@fastify/rate-limit`: global 1000/min per IP
  (`trustProxy: true` — the API only ever sits behind Traefik or the Vite
  proxy, so X-Forwarded-For is honest), with tight per-route configs in
  `plugins/rate-limits.ts` for the expensive routes: wiki scrape 5/min
  (Fandom is Cloudflare-fronted and bans IPs), uploads 20/min, art/cover
  browses 30/min, OCR imports 10/min, barcode 10/min (UPCitemdb ~100/day).
  better-auth's own `rateLimit` guards credentials: sign-in 5/min,
  sign-up 5/hour. SQL was already clean (Drizzle parameterizes everything,
  including tagged `sql` templates); the one real find was
  `suggestMissionsFromUrl` accepting any host *ending* in "fandom.com"
  ("evil-fandom.com") — now exact-host or dot-suffix plus http(s) only.
- **Crowd-sourced data has one shape**: a user makes something private, opts
  into publishing it, and everyone else takes an independent copy. Checklists
  and collections both work this way, and both are now rated by the same
  `services/votes.ts`. Publishing is always a deliberate act — an adopted copy
  starts private, because publishing someone else's work is their call — and
  every publishable string passes `services/content-filter.ts` on write *and*
  again, in full, at publish. **Aggregates** (`services/community.ts`) are the
  one exception to "opt in": an average rating or play time is derived from
  data you already store, so it needs no publish step, and is protected by a
  minimum-contributor floor instead.
- **One funnel for category badges**: `statusChip()` (`apps/web/src/lib/format.ts`)
  resolves colour *and* applies `preferences.badge_opacity`, so the opacity setting
  lands on every badge on every page for free. Mobile mirrors it through
  `statusStyle(status, opacity)` in `lib/ui.ts`.
- **Physical vs digital is a format, not a shelf** — `user_game_platforms.format`,
  toggled per platform on a game's page. That's the whole of the physical-copy
  feature now. The 3D box viewer, `services/boxart.ts` (libretro-thumbnails
  scans) and `packages/shared/src/case-colors.ts` were removed in phase 20;
  `game_box_art` survives as a parked table backing nothing.
- **The public pages are prerendered to real HTML** (`apps/web/scripts/prerender.mjs`,
  run by `pnpm --filter @gm/web build` after `vite build`). The app is a
  client-rendered SPA, so every URL on gamesmanager.app used to serve
  `<div id="root"></div>` — 53 bytes — plus the landing page's `<title>`,
  its description and a `<link rel="canonical">` pointing at `/`. Googlebot
  runs JavaScript and saw the real pages; **AdSense's review crawler does
  not, and rejected the site as "low value content"** on the strength of
  eleven URLs that each declared themselves a copy of the homepage and
  contained nothing. The prerenderer renders each public route through
  Vite's SSR module runner and writes `dist/<route>/index.html` with the
  markup inside `#root` and that route's real head tags.
  **Adding a public route means adding it to `src/prerender/entry.tsx`** —
  it keeps its own marketing-only route tree, because importing `main.tsx`
  would pull in every signed-in page and run its `createRoot` at module
  scope. Three things make it work: `useSeo` records its input under
  `import.meta.env.SSR` instead of touching a `document` that isn't there
  (`takeSeo`/`resolveSeo` in `lib/seo.ts`, shared with the hook so the two
  can't drift); `better-auth/react` is aliased to a permanently signed-out
  stub (`src/prerender/stub-auth.ts`), signed-out being the only view a
  crawler can have; and it is **prerendering, not SSR** — `main.tsx` still
  mounts with `createRoot`, which replaces the container outright, so there
  is no hydration and no mismatch to keep in step.
- **`dist/app.html` is the SPA fallback, not `index.html`.** nginx does
  `try_files $uri $uri/ /app.html`, so `$uri/` picks up the prerendered
  directories and everything else — the signed-in routes, which are not
  prerendered — gets the empty shell. Falling back to `index.html` would
  flash the prerendered landing page before the app mounted. `app.html` is
  byte-for-byte what `index.html` used to be. `scripts/serve-dist.mjs`
  serves `dist/` under those exact rules for checking a build locally;
  `vite preview` can't, because it falls back to `index.html`.
- **The site carries no ads at all** (phase 24). Both systems are gone: the
  in-app house ads (`lib/ads.ts`'s `MockAdService`, `AdBanner`,
  `AdInterstitial`) and the AdSense placements (`AdSlot`, `AdRail`,
  `lib/adsense.ts`, the site tag in `index.html`, `public/ads.txt`). Every
  `AD_SLOTS` id had always been empty, so the only thing that ever rendered
  was a placeholder — "Your ad could be here", on every signed-in page.
  `MarketingLayout` is a single centred column now rather than a content
  column flanked by two 300px rails, and `lib/premium.ts` went with them
  (`user.is_premium` stays — the admin Users tab reads it). **The legal
  copy is part of the feature**: the privacy policy's Advertising section
  and its third-party-cookie paragraph, and the terms' "the free tier is
  supported by advertising", all described something that no longer
  happens. If ads ever come back, they come back with those paragraphs.

- **Publishing can be a setting instead of a button** (`preferences.publish_mode`,
  migration 0026). Three modes: `manual` (the original — private until you
  press Publish), `never` (private, and the control is gone) and `always`
  (published the moment it exists). `publishModeFor`/`publishOnCreate`
  (`services/preferences.ts`) are the only readers, and an unrecognised stored
  value falls back to `manual` — a preference we can't read must never be the
  reason something gets published. Three rules hold it together:
  **adopt is exempt** (`isPublic: false` is hardcoded in both adopt paths —
  publishing someone else's work is their call, and `always` doesn't change
  that), **nothing is retroactive** (switching modes never republishes or
  unpublishes what exists), and **`never` is enforced server-side** — both
  PATCH routes 403 a publish attempt, so hiding the button in the two apps is
  the courtesy rather than the mechanism. Unpublishing is never refused: the
  mode governs what goes out, not what comes back, which is also why an
  already-published item keeps its button under `never`.
- **Games link to their DLC, prequels, sequels and remakes** (`user_game_links`,
  migrations 0026–0027). Per-user, *not* catalog: the relationship is arguably
  a fact about the games, but writing it to the shared `games` rows would let
  one mis-click reorganise everyone's library — the mistake phase 16 undid for
  play times. What the table records is a decision about *your* library, which
  is the actual problem (Steam sells DLC as its own app, so it imports as its
  own entry). The row is **directional**: `game_id` is the base and
  `related_game_id` is what hangs off it, with `kind` saying what the related
  game is *to* the base. **Kinds and roles are two different things.** There
  are three stored kinds — `dlc`, `sequel`, `remake` (which covers remasters;
  0027 folded `remaster` into it) — and six *roles*, which are a kind read from
  one end (`GAME_LINK_ROLES`/`GAME_LINK_ROLE_META` in shared constants): the
  base game sees `dlc`/`sequel`/`remake`, the related game sees
  `base_game`/`prequel`/`original`. **There is no `prequel` kind on purpose**:
  "A is the prequel to B" is the same fact as "B is the sequel to A", and
  storing it once is what makes a link show on both games without the two
  pages ever disagreeing. The UI and the API only speak roles — `POST
  /api/games/:gameId/links` takes `{ role }` and maps it to a kind and an end —
  and `gameLinksFor` (`routes/games.ts`) returns every role as a section, both
  ends of every row, whether or not you own either game. **One link per pair**:
  the same link again is an idempotent 200; any *other* link between the two
  (the inverse, or a second kind) is a 409 that names the section it's already
  under. **Two orders per row** (`base_position`, `related_position`), because
  a row sits in two lists — Half-Life 2's prequels and Half-Life's sequels are
  separate hand orders — and the sort per section (`release` | `custom`) lives
  in `user_game_link_sorts`, keyed (user, game, role): neither end has a
  per-user row to hang it on when you don't own the game, and a flag copied onto
  every link in a section would drift. Sorting happens server-side so web and
  mobile show the same order.
- **The repo is public, and the site says so.** `GITHUB_REPO_URL`
  (`packages/shared/src/constants.ts`) is the single copy of the URL; the
  footer links it on every page, the FAQ's self-host answer links it, and the
  privacy policy points at it as the thing you can check the policy against.
  A FAQ item's `link` is rendered *beside* its answer rather than inside it,
  because `FAQ_ITEMS` also feeds the FAQPage structured data and that wants
  plain text. `deploy/docker-compose.selfhost.yml` + `deploy/nginx.selfhost.conf`
  are the stack a stranger can actually run: both images built from the repo,
  no GHCR login, no Traefik, no Watchtower, and nginx proxying `/api` to the
  API container — that proxy is **required**, not a convenience, because
  sessions are same-origin HTTP-only cookies and a second origin for the API
  would mean they were never sent. `docker-compose.prod.yml` stays what it
  was: the gamesmanager.app deployment, pulling private images.

## Commands

```bash
docker compose -f deploy/docker-compose.yml up -d   # dev Postgres
pnpm db:migrate && pnpm db:seed                      # migrations + platform seed
pnpm dev:api   # :3001 (tsx watch)
pnpm dev:web   # :5173 (proxies /api → :3001)
pnpm dev:mobile  # Expo Go; needs EXPO_PUBLIC_API_URL=<LAN IP> in apps/mobile/.env
pnpm --filter @gm/api db:generate   # after schema changes → new SQL migration
pnpm --filter <pkg> typecheck       # per-package tsc
pnpm db:seed-demo                   # (re)build the /demo showcase account
```

Migrations are plain SQL in `apps/api/drizzle/`, applied by `src/db/migrate.ts`
(programmatic, also runs on Docker boot **along with the idempotent platform
seed** — production once shipped with an empty platforms table because seeding
was dev-only). Never use `db push`.

## Environment gotchas (this dev machine)

- **git push hangs from PowerShell** (credential-manager quirk) — push from Git Bash;
  gh CLI is installed and authed as **BryanSimp**. Repo: github.com/BryanSimp/game-manager-2 (private).
- **Docker Desktop takes 2+ min to start** and may need a relaunch; poll `docker info`.
- curl `-F @file` in Git Bash needs **Windows-style paths** (`C:/...`), not `/tmp/...`.
- Dev DB has throwaway accounts: `test@example.com` / `second2@example.com`
  (password `testpassword123`); test@ is the admin. IGDB credentials are configured in
  the dev DB's settings table (must be re-entered on server deploy).
- CI (`.github/workflows/docker.yml`) pushes `ghcr.io/bryansimp/gm2-api|gm2-web` on
  every push to main. GHCR packages are private — server pulls need a PAT login.

## Phase log

| Phase | Commit | What landed |
|---|---|---|
| 0 scaffold | `ff323fe` | Monorepo, auth on web+mobile, schema+migrations, compose files, CI |
| 1 MVP library | `7fe0771` | IGDB search/metadata/TTB, library CRUD, platform ownership (physical/digital), half-star ratings, bulk add, admin IGDB settings, mobile library/add/detail |
| 2 customization | `f3f1086` | Tags (colors/groups), library filters+sort, custom cover upload, preferences (status colors, badges), dashboard (stat tiles, backlog hours, random pick) |
| 3 OCR import | `69a66cf`, `b0eb5c0` | pg-boss pipeline, tesseract + Claude vision providers, noise filter (hardened on a real Steam screenshot), confidence-scored review UI on web+mobile, camera capture on mobile |
| 4 shelf + collections | see git log | Virtual shelf (per-console rows, physical boxes with console-colored spines vs digital tiles, sort modes + drag-to-reorder persisted in `user_game_platforms.position`); collections with SVG play-order graph editor (drag nodes, connect mode, click-edge-to-delete, status rings), roll-up stats; mobile shelf screen |
| 5 mobile polish + camera | see git log | Barcode scanning: `expo-camera` scan screen → `GET /api/lookup/barcode/:code` (`services/upc.ts`: UPCitemdb trial tier, platform hint parsed out of the retail product title, then the OCR matcher for IGDB candidates; in-memory result cache since the tier is ~100/day). Offline caching: AsyncStorage persister + `PersistQueryClientProvider` (7-day maxAge; search/barcode queries excluded); better-auth's expo client already serves its SecureStore session cache offline. Parity screens: dashboard, collections list/detail (play-order graph flattened to a list), tag manager, account hub with sign-out, library search+sort. `metro.config.js` resolver shim retries `.js` specifiers as `.ts` — **mobile bundling was broken without it** |
| 7 checklists | see git log | `checklist_templates`/`checklist_items`/`user_checklist_items` (migration 0005); routes in `routes/checklists.ts` — CRUD, granular item ops, `PUT items/:id/check` toggles per-user progress (only on templates you author), publish flag, **adopt = private copy** (`adopted_from_id` provenance), admin can delete public templates. Web: `ChecklistPanel` on GameDetail (progress bars, category grouping, publish toggle, adopt). Mobile: track/adopt on game detail (authoring is web-first). Verified live with both dev accounts incl. permission boundaries |
| 9 progress + time remaining | see git log | **TTB mapping fix**: IGDB's `hastily`/`normally` were mapped to the wrong columns in `services/catalog.ts`, so main story read *longer* than main+extras (MGSV: 101h vs 49h). Correct mapping is hastily→main, normally→main_extra, completely→completionist; `normalizeTtb` (`packages/shared/src/progress.ts`) enforces the ordering on ingest and migration 0006 sorts existing rows in one pass (pairwise swaps re-invert — don't). **Mission lists**: `checklist_templates.kind` ('completion'\|'missions') + `source_url`; `services/missions.ts` scrapes Fandom via the per-wiki MediaWiki `api.php` (Fandom's cross-wiki directory API is dead and community.fandom.com is Cloudflare-gated, so the wiki subdomain is *guessed* from the title and probed). Extraction tries missions-as-subsections, then lists/tables in a matching section, then whole page, and **scores** each candidate — first-match-wins picks the wrong list. **Estimate**: `user_games.progress_basis` picks which TTB figure `estimateProgress` divides across the mission list. Web: `ProgressPanel` on a new Progress tab (achievements + checklists moved there); mobile: read-only estimate + mission ticking |
| 8 Steam | see git log | `steam_accounts`, `achievements`, `user_achievements`, `games.steam_app_id`, `user_games.steam_playtime_minutes`; `services/steam.ts` (official Web API, key DB-first/`STEAM_API_KEY` fallback, ~250ms throttle, vanity-URL resolve); two pg-boss queues in `jobs/steam.ts`: **import** (owned games → ≥0.85 matcher confidence auto-adds with appid+playtime, leftovers become a `source='steam'` import job for the normal review UI; `import_items.steam_app_id` dedups re-imports) and **sync** (per linked appid: schema achievements upsert + player unlock state). Web: `SteamCard` on Preferences (link/import/sync, polls while jobs run), Steam key section on admin Settings, `AchievementsPanel` on GameDetail (icon grid + playtime). Mobile: read-only achievements + checklists on game detail |

| 10 friends | see git log | `friendships` (requester/addressee + `pending`/`accepted`, one row per pair in either direction) and `user.friend_code`, generated **lazily** on first friends-page view so existing accounts need no backfill. `services/friends.ts` owns the code alphabet (no O/0/I/1/L/S/5/B) and `normalizeFriendCode`, which validates rather than "corrects" lookalikes — a typo must fail to match, never match something else. Adding is **request → accept**: a code alone never exposes a library. `routes/friends.ts` returns the same "no one found" message for a bad code and for your own, so the endpoint can't be walked as a user directory. Friend library responses deliberately omit `notes`. Web: `/friends` (code, requests both ways, overlap counts) and `/friends/$userId` (their library, `inCommon` flagged, filter by everything/common/theirs) |

| 11 consoles | see git log | **The virtual shelf is gone** — route, both pages, `ShelfRow`/`ShelfEntry`, the shelf-order endpoint and `user_game_platforms.position` (migration 0012). In its place: `user_consoles` + `routes/consoles.ts` (list with per-console counts and cover previews, add, remove) and `services/consoles.ts`. Migration 0012 backfills the list from existing ownership so nobody starts empty. Web `/consoles` and `/console/$platformId`; mobile `consoles.tsx` is read-only. Also in this phase: **PC storefronts** (Steam/Epic/GOG/…) seeded as platforms with Steam import filing under Steam; **quick add** on `/add` (pinned platform + category, adds in place) and a **release-year** narrowing the IGDB search (`first_release_date` bracketed in UTC); **bulk platform edit** in the library's select mode (`platformMode: add\|replace\|remove`); preferences for **badge opacity** and a **default platform** (+format) applied by `POST /api/library` when the caller doesn't name one |
| 11b sub-platforms | see git log | Storefronts became **children of PC** rather than siblings (`platforms.parent_platform_id`, migration 0013), so a Steam game counts as a PC game everywhere while still saying Steam. `ConsoleSelect` is now two dropdowns (platform, then storefront) and is used by quick add, import, preferences and bulk edit alike; the library filter gained `PC (all)` plus indented stores; the consoles page nests storefront cards under their platform. Added **Origin**, renamed Microsoft Store → **Xbox / Microsoft Store**. Per-user **console art** (`user_consoles.custom_image_id`, upload/reset on each card). Nav shrunk to `text-xs` so ten links stay on one row |
| 11c import accuracy + polish | see git log | **Steam matching by appid**: `findIgdbGameBySteamAppId` (IGDB `external_games`, `external_game_source = 1`) resolves an appid to the exact game before any title matching; a store-API release-year tiebreak (`getAppReleaseYear`, capped per run) handles what's left. `steam_import_rules` (migration 0014) adds per-user `block`/`map` overrides, set from `SteamMatchFixer` on a game's page and reviewed in `SteamCard`. **Console art browsing** (`services/console-art.ts` → IGDB logos + Wikimedia Commons, `ConsoleArtBrowser`). **Badge chips** became dark plates of the category hue so they read over cover art at 100% opacity. Library hides empty category chips. `preferences.show_rating` hides card star ratings on web and mobile |

| 12 mobile parity + polish | see git log | **Friends on mobile**: `friends.tsx` (code + `Share`, requests both ways, unfriend) and `friend/[userId].tsx` (their library, everything/common/theirs, search). **Consoles on mobile**: cards nest storefronts under their platform and open a new `console/[platformId]` page (format filter, per-store badges), and the library gained a **console filter row** that rolls storefronts into their parent — `lib/platforms.ts` owns `onPlatform`/`groupConsoles` so both screens agree. **Batch barcode scanning**: `scan.tsx` queues game after game and writes the batch only when confirmed. **Layout fixes**: safe-area bottom insets on every screen (FABs, sheets, the import footer), sort moved off the search row into a picker, dashboard category tiles widened from a fifth to a third so "Uncategorized" stops clipping, import review split onto two lines, header icons wrapped in a row |

| 12b design system + barcode titles | see git log | **`lib/theme.ts` + `components/ui.tsx`**: colour/space/radius tokens and a type scale where every entry has a `lineHeight`, plus shared `Screen`/`Card`/`Chip`/`Badge`/`Button`/`Field`/`EmptyState`/`Cover`/`ProgressBar`. Fourteen screens stopped hand-rolling StyleSheets, which is what had been clipping descenders and emoji. **Emoji chrome became Ionicons** (`@expo/vector-icons`, pinned 15.1.1) — a glyph centres in its box and takes a colour. **Barcode titles**: `services/product-title.ts` strips SKUs/editions/platform from a retail listing and offers publisher-dropped `variants` that only win if IGDB scores them higher; `check:titles` covers 18 cases |

| 13 sharing + corrections | see git log | **Collections publish/adopt** (migration 0015): `is_public` + `adopted_from_id`, `GET /api/collections/public`, `POST /:id/adopt` deep-copying games and links, star badge on both apps, Yours/Public tabs. Adding a game is now a **search** (library first, IGDB underneath) and accepts `igdbId`, so a collection can list games you don't own. **Manual play times** (`PUT /api/library/:id/time-to-beat`) with an "Add play time" affordance when IGDB has none. Mobile caught up on three things web had: a **half-star rating** widget, **cover browsing/upload**, and **console art browsing/upload**. Header button became a hamburger |

| 13b collection views + bulk add | see git log | **Two views per collection**: the play-order graph, and a **list** sortable by custom order / title / release date / time to beat. `collection_games.sort_order` (migration 0016, backfilled from the graph layout) holds the custom order, written only by `PUT /:id/order` so the graph and the list can't scramble each other. Rows link to your copy of a game, or to the add-game search when you don't own it (`/add?q=`). **`POST /:id/add-to-library`** adds every game in a collection at once with a chosen category and platform — the reason to browse a public one |

| 14 admin analytics | see git log | **`analytics_events`** (migration 0018, jsonb meta, no FK on user_id so a batched flush can't fail on a deleted user; backfills funnel history from `user`/`steam_accounts`/`user_games`/`collections`). **Non-blocking logger** (`services/analytics.ts`): in-memory buffer, batched insert every 5s (or 200 events), capped at 5k, timer `unref`'d, failed flush dropped — telemetry never breaks the app. Fastify `onResponse` hook logs authenticated activity via `request.sessionUser` (stashed by `getSessionUser`), after the reply is sent. Funnel events: `sign_up` (better-auth after-create hook), `steam_link`, `game_added` (single/bulk/Steam auto-add), `collection_created` (create + adopt). `logScrape()` records outcomes for missions/boxart/upc/steam jobs/OCR. **Admin endpoints** (`routes/analytics.ts`): funnel, DAU (30d, gap-filled), WAU/MAU, avg games/user, avg session (30-min-gap sessionization in SQL), scraper success rates (7d) + recent failures; both flush the buffer first so numbers are current. **Web `/admin/analytics`** (Observable Plot, dark-only): KPI tiles, funnel bars on a validated blue ordinal ramp, DAU line with crosshair tip + table twin, scraper meter bars polling every 15s. Verified end-to-end (backfill counts, live activity, real UPC scrape event) |

| 15 password reset | see git log | **Not the better-auth built-in** — better-auth 1.6 stores reset tokens *raw* in `verification`, so `routes/auth-recovery.ts` owns the flow: `password_reset_token` (migration 0019) keeps only a SHA-256 hash of a 32-byte token, 15-min expiry, single-use (consumed via `DELETE … RETURNING`), one live token per user. The routes are static `POST /api/auth/request-reset` / `reset-password`, which Fastify matches ahead of the better-auth wildcard — deliberately shadowing its unhashed equivalents. The password *update* still goes through `auth.$context` (scrypt hash + `internalAdapter`, mirroring better-auth's own resetPassword) and revokes every session. Request-reset answers identically for known/unknown emails, checks config *before* touching accounts (503 when unconfigured), fire-and-forgets the send so response timing can't leak account existence, and rate-limits 3/15-min per IP and per email in memory. **Email is Resend** (`services/email.ts`, plain fetch): `resend_api_key`/`email_from` DB-first with `RESEND_API_KEY`/`EMAIL_FROM` fallback, admin Settings card with send-test button; reset links target `APP_URL` → first CORS origin → `BETTER_AUTH_URL`. Web: `/forgot-password` + `/reset-password?token=` pages; mobile: "Forgot password?" on the sign-in screen reuses the typed email (no new screen — the emailed link opens web) |

| 16 shared lists + community data | see git log | **One list surface per game** (migration 0020): `checklist_templates.position`, so a game has one main-story list plus unlimited extras in an order you set. `ChecklistPanel` is gone — the Progress tab's `ListCard` publishes, copies, votes, reorders and edits every list identically, which is what finally made *mission* lists shareable (the API always allowed it; only the `kind='completion'` filter stopped it). `completion` folded into `side_quests` and now backs nothing. One `missions` list per game, enforced with a 409, because it's what the time estimate divides. **Wiki scraping removed** — `services/missions.ts`, the suggest route, `scraperRateLimit` and `MissionReview` all gone; pasting a list is the create path now. **Votes** (`checklist_votes`, `collection_votes`, `services/votes.ts`): thumbs on published lists and collections, aggregated on read, public-only and never your own. **Community data** (`services/community.ts`): average rating (floor of 3 raters — a privacy floor, not a quality one) and average play time. `PUT /time-to-beat` stopped writing the shared catalog row and writes `user_time_to_beat`; `resolveTtb` (shared) picks catalog → yours → community per request, and the dashboard's backlog total goes through the same resolver. **Content filter** (`services/content-filter.ts`): hate terms + PII on every write to a collection or list, plus a whole-list re-scan at publish. **Collection discovery**: `GET /api/collections/public` takes `q`/`gameId`/`sort`/paging, `q` matches game titles inside a collection, `GET /:id` opens to owner-or-public, and the graph opens read-only with click-through to a game. List tab moved first |

| 17 feedback + progress polish | see git log | **In-app feedback** (`feedback` table, migration 0021): `POST /api/feedback` (signed in, so it never asks who you are), `GET /api/feedback/mine` so filing isn't shouting into a void, and an admin queue at `GET /api/admin/feedback` with `q`/`kind`/`area`/`status`/`sort` plus PATCH triage, DELETE and `export.csv`. Deliberately **not** the marketing contact form (that one is anonymous and sends mail) and deliberately **not** run through `content-filter.ts` — a bug report often has to quote the thing that broke. Web: `/feedback` in the nav, and a **Feedback tab on `/admin/analytics`** with status tiles that double as filters, an expandable table with inline triage, CSV export (server-side, honours the filters, BOM'd for Excel) and PDF export (a printable window → the browser's own Save as PDF, so no PDF dependency). **Collections open the game** — `GET /api/games/:gameId` returns a catalog game plus your entry id, and `/catalog/$gameId` renders it with a one-button add; both the list rows and the graph nodes used to dump you in `/add?q=<title>`, i.e. searching for a game the app had already identified. Owning it redirects to your copy. **Progress tab**: publish moved off a footer checkbox onto a button beside the list's title (reachable while collapsed, so its content-filter errors moved out of the open body too), and both sections got a **Browse public lists** button — shown at zero as well, because a control that only appears once someone else has published can't teach you that sharing exists |

| 18 demo tour + honest landing page | see git log | **`/demo`** is the real app served from a seeded showcase account (`user.is_demo`, migration 0022) — not a second, fake build that rots the moment a screen changes. A request opts in with the `x-gm-demo` header; `getSessionUser` hands back the demo user as if it had signed in, and **one `onRequest` hook in `server.ts` refuses any demo request that isn't a read**. That hook is the entire view-only guarantee: no route knows the demo exists, and routes added later are covered without being told. The client refuses writes too (`lib/api.ts`) so visitors read a sentence about signing up rather than a 403. Demo accounts have **no `account` row**, so there are no credentials to sign in with, and `is_demo` keeps them out of the first-user-becomes-admin count, community rating/play-time averages, the DAU activity log and the analytics user total. `scripts/seed-demo.ts` (`pnpm db:seed-demo`) is idempotent and pulls games through `upsertGameFromIgdb` when IGDB is configured, so the tour has real covers — degrading to title-only rows when it isn't. `GET /api/demo/status` lets the button hide itself on instances that never seeded. **Landing page audited against the code**: removed wiki mission import (gone in phase 16), "cartridge/boxed/sealed" completeness (only physical/digital exists) and "export your data whenever you like" (not built); added backlog planning, the physical shelf + 3D box viewer, the mobile app, community averages and list publishing |

| 19 admin demo control | see git log | **Scraper health is gone** — the card, `GET /api/admin/analytics/scrapers`, `getScraperHealth`, the `ScraperHealth` type, `logScrape` and all 15 call sites. The wiki scraper died in phase 16 and the rest (boxart/upc/steam/ocr) were writing `type='scrape'` rows nothing read. Historical rows stay; nothing queries them. **The demo is admin-managed**: the seed moved from `scripts/seed-demo.ts` into `services/demo-seed.ts` (the script is now a wrapper) and gained `seedDemo()`/`removeDemo()`/`demoStats()` plus in-memory progress, because two dozen throttled IGDB lookups can't sit in a request — `POST /api/admin/demo/seed` returns 202 and `/admin/demo` polls. **Editing the demo is the app itself**: `x-gm-demo-edit` makes every route act on the demo account while keeping the admin's own role, so the tour is curated with the Library, Collections and Progress screens it advertises. It's a *different* header from the tour's `x-gm-demo`, so the view-only hook doesn't fire, and it's honoured only when the session user is already an admin. Amber banner + header pill throughout, because every screen looks exactly like your own. **The Demo button is now unconditional** (it used to hide when unseeded, which left an admin with no button and no explanation); `/demo` handles an unbuilt demo with a page that says so and links admins to `/admin/demo`. Button order is Get started → Demo → Log in on all three surfaces |

| 20 drop the 3D boxes | see git log | **The 3D box viewer is removed entirely**, with the pipeline behind it: `BoxViewer3D.tsx`, `services/boxart.ts`, `packages/shared/src/case-colors.ts` (`BOX_SPECS`/`caseColorFor`/`FAMILY_ACCENT`), the `game_box_art` join in `entryPlatforms`, and `boxArtSrc`/`boxArtW`/`boxArtH` on `OwnedPlatform`. Half of it was already dead: nothing had called `ensureBoxArt` since the virtual shelf went in phase 11, so the library route was joining a table nothing wrote to. **Physical vs digital ownership stays** — that was never part of the viewer, it's `user_game_platforms.format` and the per-platform toggle on a game's page. `game_box_art` is parked rather than dropped (its rows point at image files on the volume, and there's no orphan cleanup). Landing copy corrected again: the physical feature tab now shows the ownership toggle instead of a spinning box, and the box-scan claims came out of `Landing.tsx`, `Faq.tsx` and the physical-collection guide |

| 21 roll with filters, rows you choose | see git log | **The backlog randomizer takes filters** (the Phase 6 item): "What should I play next?" rolls from a chosen category *and* console — storefronts roll into their platform, so picking PC includes Steam — and says how many games it's picking between. The card grew a cover twice the size, the release year, main-story and completionist times and the summary, clamped to six lines so the text ends about level with the cover. **Recently finished fits its box**: the row measures itself (`useFitCount`, a `ResizeObserver` on a container whose width doesn't depend on its contents, so trimming can't loop) and renders only the covers that fit, with `+N more` for the rest — it used to scroll sideways and slice a cover in half at the card's edge. **Preferences is two panels to a row** above `lg`; `SteamCard` stopped setting its own width and margin. **`preferences.library_columns`** (migration 0023, 1–8, default 5) drives the library grid, with a `per row` select in its toolbar. The classes are whole literal strings in `COLUMN_CLASSES` because Tailwind can't see `grid-cols-${n}`, narrow breakpoints keep their own counts, and below five the grid is capped at `MAX_CARD_PX` per card — a full-width 3:4 cover is a poster, not a card |

| 22 identity, accounts, 2FA | see git log | **The app has a tab icon**: `apps/web/public/icon.svg` (an indigo tile with a gamepad knocked out of it via a `mask`, because the tile is a gradient and a flat-filled cut-out only lines up at one height), rasterised to `favicon.ico` (16/32/48), `icon-192/512.png` and `apple-touch-icon.png` by `apps/web/scripts/generate-icons.mjs` — run by hand, outputs committed, uses `@gm/api`'s hoisted `sharp` rather than a second copy. Plus a `site.webmanifest`. **Admin Users tab** on `/admin/analytics`: `GET /api/admin/users` (`routes/admin-users.ts`) with search, four filters, five sorts and paging. Per-user counts are **scalar subqueries, not joins** — four left joins over one-to-many tables multiply rows together and every count comes back plausibly wrong. Read-only on purpose; bans and role changes belong in the phase 6 admin panel. Demo accounts *are* listed (flagged and filterable) — this is the one place hiding them would be a lie. **A friend's games are links**: `FriendLibraryEntry.myUserGameId` (your `user_games.id`, not just `inCommon`) sends a card to your own copy, or to `/catalog/$gameId` when you haven't got it; mobile does the same, falling back to `/add?q=<title>` since it has no catalog screen. **Two-factor sign-in** (migration 0024): better-auth's `twoFactor` plugin, TOTP only — an emailed code would arm a lock whose key can't arrive on an instance with no verified Resend domain. `trustDeviceMaxAge` of 30 days is the thing that makes it "a new device" rather than every sign-in. Enabling is two steps and a code has to prove the secret before it's armed (`skipVerificationOnEnable` deliberately left off), backup codes are shown exactly once, and `TwoFactorCard` renders the QR with `qrcode-generator` behind a dynamic `import()` — zero transitive deps, and out of the main bundle. Both login screens grew an in-place challenge step; **the mobile client got `twoFactorClient()` too**, or turning 2FA on in the web app would have locked the phone out. "New backup codes" regenerates a set without touching the secret. The correlated subqueries in `admin-users.ts` all go through a `qualified()` helper — Drizzle emits bare column names in `sql` templates, which Postgres binds to the *inner* table, and against `session`/`collections` (text ids, like `user.id`) that's a silent zero rather than an error |

| 23 quick actions + filing from the game | see git log | **A ⋯ button on every library cover** opens `QuickActions.tsx`: category (with the 100% chip), rating, tags, consoles (including the physical/digital toggle) and collections — the whole reason you used to open a game and come back. Nothing in it navigates. The panel is `position: fixed` and placed against its button by `useAnchoredStyle`, which opens it *outward* so the card you're editing stays visible beside it, flips it above when the bottom of the window is nearer than the panel is tall, and re-places it with a `ResizeObserver` as sections inside it expand. **The grid holds still while you edit**: `heldOrder` snapshots the rendered order the moment a panel opens, and until you press *↻ Re-sort* — or touch a filter, the sort or the search box — held cards keep their slot *and* stay on screen once an edit takes them out of the current filter. Marking a backlog game beaten while filtered to Backlog used to make the card vanish mid-edit; now it gets a dashed border and the toolbar says how many are being held. **Filing a game into a collection from the game itself** (`CollectionPicker.tsx`): `GET /api/collections` takes a `?gameId=` and flags each collection with `containsGame`, so the control is chips for the collections it's already in (✕ takes it out), a list of the rest, and a name field that creates one and files the game in a single click. It's on the card panel, the game page and `/catalog/$gameId` — a collection is a reading list, so it works on a game you don't own. |

| 24 no ads, public repo, collections that know their length | see git log | **Every ad placeholder is gone** — the house-ad `MockAdService` (`AdBanner` was rendering "Your ad could be here" on every signed-in page) and the AdSense rails/slots/site tag/`ads.txt`, plus the privacy and terms paragraphs that described ads the site no longer serves. **The repo is public and linked**: `GITHUB_REPO_URL` in shared constants, a footer link on every page, the FAQ's self-host answer, and a README that is an actual self-hosting guide — backed by `deploy/docker-compose.selfhost.yml`, a stack built from source with no registry login and no Traefik, whose nginx proxies `/api` so sessions stay same-origin. **A collection can be built from a pasted list**: `POST /api/collections/:id/games/from-list` matches up to 50 titles through the existing matcher (`ocrVariants: false` — a typed list has no OCR damage to repair) and files them in pasted order; there is no review step because every line comes back with what it matched and its score, and a wrong row is one click to remove. Offered on the create form and inside an existing collection's add panel. **Collections show how long they take and how much is left**: `services/progress.ts` now owns `missionCountsByGame` (moved out of `routes/library.ts`, so the library card and the collection total can't drift) plus `gameTime`/`addGameTime`; a finished game contributes nothing to remaining, a part-ticked mission list is pro-rated by the same `estimateProgress` the Progress tab uses, and endless games leave both totals. Surfaced on the detail page, your cards, the public browse cards, and mobile |

| 25 publish once, and games that know their DLC | see git log | **Publishing became a preference** (migration 0026): `publish_mode` is `manual`/`never`/`always`, applied by `POST /api/collections` and both checklist-create routes, with a Sharing panel on Preferences. `never` is enforced by the API (403 on a publish PATCH) as well as hidden in both apps; adopted copies stay private under every mode, and switching modes is never retroactive. **Games link to other games** (`user_game_links`): per-user `dlc`/`remaster`/`remake` links with `GET`/`POST`/`DELETE /api/games/:gameId/links`, stored one direction and flipped by a `direction` flag on the way in so a pair can't exist twice swapped (the inverse is a 409, a self-link a 400, a repeat an idempotent 200). Web gets `RelatedGames` on the game page — a "Link a game" button, a library-first/IGDB-underneath search, and the relation picked as a sentence ("… is DLC for this game") rather than a kind plus a direction toggle; sections appear as links are made, so a game with no DLC shows no empty shelf. Mobile shows the links read-only and can open either end. The library grid is deliberately untouched: a linked DLC keeps its own card |

| 26 the Linked tab, and collections that fill your gaps | see git log | **Four link types, one row each** (migration 0027): DLC, Prequel, Sequel and Remake/Remaster, stored as three kinds (`dlc`, `sequel`, `remake` — `remaster` folded in) and read as six *roles* depending on which end you stand on (`GAME_LINK_ROLE_META`), so a prequel added on one game is the sequel on the other with nothing stored twice. `POST /api/games/:gameId/links` takes `{ role }`; one link per pair, and any other link between the two is a 409 naming the section. **A Linked tab** on `/game/$id` *and* `/catalog/$gameId`, so a DLC you don't own still says what it's DLC for: an "＋ Add a link ▾" type menu, a picker that links as many games as you like and marks ones already filed, and a section per role in **release-date or custom order** — remembered per section (`user_game_link_sorts`) and hand-set per end (`base_position`/`related_position`; `PUT /links/order`, `PUT /links/sort`). The old inline Related games block became a "🔗 N linked games ▾" dropdown under the title, and the game page's tab moved into the URL (`?tab=`) so Back returns to it. **Collections fill your gaps**: `add-to-library` takes `gameIds`, and `MissingGamesBar` offers add-all to Wishlist, Backlog or any other category, or *Choose games* checkboxes for some of them; mobile gets a one-sheet equivalent and reads the new link sections. The demo rebuild now clears links and link sorts too — it never had |

**Next: Phase 6 remainder (still open)** — email verification (better-auth config
flip, can ride on `services/email.ts` now), data export (JSON/CSV), admin panel
(password resets, registration toggle, account actions — the *list* landed in
phase 22, read-only).
**Deployment to Bryan's Ubuntu/Portainer server is the current focus** (v1's compose
file to be provided for reference).

## Deferred / known gaps

- **`publish_mode` decides the default, not the ceiling — except under
  `never`, where it is the ceiling.** An explicit `isPublic` in a create
  request wins under `manual` and `always`; under `never` it is ignored and
  the row is written private, matching the 403 the PATCH route returns. That
  asymmetry is the whole point of having `never` as a separate mode from
  `manual`, which otherwise behaves identically.
- **Nothing about `publish_mode` is retroactive.** Switching to `always`
  doesn't publish what you already have, and switching to `never` doesn't
  unpublish it — it only stops new things going out, and leaves the button on
  anything already public so you can take it back yourself. A "publish
  everything I own" action would be a different feature, and a destructive
  one.
- **Game links are per-user and never reach the catalog.** Two people can
  disagree about whether something is a sequel or a spin-off and both are
  right in their own library. The cost is that everyone links their own DLC
  from scratch; IGDB already models `dlcs`/`expansions`/`remakes`/`remasters`
  on the games we import, so seeding suggestions from it is the obvious next
  step — and would want to stay suggestions, written into `user_game_links`
  on acceptance rather than replacing it.
- **Links live on a Linked tab**, on both `/game/$id` and `/catalog/$gameId`
  (`LinkedGamesPanel` in `components/LinkedGames.tsx`). It has to exist on the
  catalog page too: clicking a DLC you linked but don't own lands there, and a
  link that only showed on games you own would only show half of itself. The
  four roles you add (`primary` in the meta) are always drawn, empty or not;
  `base_game` and `original` only appear once filled, since most games are
  neither DLC nor a remake — both are still in the add menu. The link type is
  chosen from a menu ("＋ Add a link ▾"), then the picker takes any number of
  games without reopening, and marks results already linked with the section
  they're under (matched by catalog id *and* IGDB id, so a result can be
  recognised before it's been pulled into the catalog). Under the title, a
  "🔗 N linked games ▾" dropdown lists them without leaving Overview.
- **A game page's tab is in the URL** (`?tab=progress|linked` on `/game/$id`,
  `?tab=linked` on `/catalog/$gameId`, via `validateSearch` in `main.tsx`).
  It used to be `useState`, which meant Back from a linked game dropped you on
  Overview, and — because TanStack reuses the component across `/game/A` →
  `/game/B` — the *next* game inherited whatever tab the last one was on.
  Tab clicks `replace` with `resetScroll: false`, so they don't stack history
  or jump the page. Opening a linked game deliberately does *not* carry the
  tab: you clicked a game, so you get the game.
- **Custom order saves as you click**, one `PUT /links/order` per arrow, with
  an optimistic cache update. Sort toggles and reorders share a
  `mutationKey`, and only the last one in flight refetches
  (`isMutating(...) === 1`) — otherwise a refetch from the first of three
  quick clicks snaps the list back mid-sequence. Reordering also flips that
  section to `custom`; switching back to `release` keeps the hand order for
  next time rather than clearing it.
- Link and collection titles in the new pickers **wrap to two lines instead of
  truncating**. DLC is named "<base game> - <the part that differs>", so an
  ellipsis turned three different DLC into three identical rows.
- **A linked DLC still gets its own library card.** Linking says what belongs
  to what; it deliberately doesn't hide, merge or roll up anything in the
  library grid, the counts, or the dashboard. Folding DLC into its base card
  would mean hiding entries people can currently see, which needs a toggle and
  a decision about every count in the app — worth doing, but as its own change.
- **Link authoring is web-only.** Mobile's game screen lists every filled
  section in the server's order and opens either end (your copy, or `/add?q=`
  when you don't own it), but can't create, remove or reorder a link — same
  line list authoring and console management sit on, and for the same reason:
  a type menu plus a search plus reorder arrows is a lot of phone screen for
  something done once per game.
- **A game can be linked to many games, but to each one only once.** "The
  remake of X, which itself has DLC" is a real shape and is allowed; X being
  both prequel and sequel of Y, or Y being both X's DLC and its sequel, is a
  409 naming the section the pair is already under. A three-game cycle (A
  before B before C before A) isn't checked — it would need a graph walk on
  every link for a shape nobody has managed to create by accident.
- Unlinking isn't confirmed. A link is one click to make again, and the picker
  stays open for exactly that.

- **A pasted collection list is only as good as the matcher.** With IGDB
  configured, each unmatched line is one IGDB search; without it, `matchOnce`
  falls back to `ilike '%<whole title>%'` against the local catalog, which
  needs the stored title to *contain* the typed one — "Majoras Mask" will not
  find "Majora's Mask". That is pre-existing behaviour shared with the OCR
  import, not something the list import added, and it only bites on an
  instance with no IGDB credentials (where nothing else can search either).
- **The list import holds the request open.** 50 titles is the cap for that
  reason: each one IGDB has to be asked about is a ~330ms throttled round
  trip, so a full list is a few seconds of spinner. It is deliberately not a
  pg-boss job — there is no OCR stage to wait on, and a collection has to
  exist with games in it before the page it opens is worth looking at. If the
  cap ever needs raising past ~50, that is the point where it should become a
  job with a review step, like the library import.
- **A collection's remaining time is yours, not the author's.** Every figure
  on `GET /api/collections/:id` resolves against whoever is asking — the same
  rule `userGameId`/`status` already followed — so browsing someone's
  published marathon tells you how much of *it* you have left. The total is
  the other way round: it's a fact about the list, so finished games stay in
  it.
- **Collection totals honour `ttb_enabled`.** A game marked endless leaves
  both figures and is counted in `time.endless` instead, matching the
  dashboard's backlog total; one Rocket League would otherwise make a
  marathon's number meaningless. Games with no known length are counted in
  `time.unknown` rather than folded in at zero, and both are named under the
  bar rather than hidden.

- Light theme (preference stored, no light stylesheet) — Phase 6.
- Email verification — Phase 6 (better-auth config flip; `services/email.ts` can send it).
  Password reset is **done** (phase 15) — never log a reset URL, and keep new reset
  logic in `routes/auth-recovery.ts`, not better-auth's built-in (raw-token) flow.
- Resend's default `onboarding@resend.dev` sender only delivers to the Resend account
  owner's inbox — a verified domain in `email_from` is required for other users' resets.
- Shelf photos of physical games are untested against real photos; tesseract can't read
  spines — needs `ANTHROPIC_API_KEY` (vision) for good results.
- Severely mangled OCR ("sonELAB" for BONELAB) won't auto-match — by design, the review
  UI's re-search covers it.
- Orphaned image cleanup job not yet written (images accumulate on the volume).
- `import_jobs.status='done'` cleanup/pruning not implemented.
- `analytics_events` has no retention job: `activity` rows accrue one per
  authenticated request. Fine at self-hosted scale for a long while; a periodic
  prune of old `activity` events (funnel events should stay) is the upgrade path.
- Barcode scan flow verified end-to-end at the API level (real BOTW/GoW barcodes) but
  the camera screen itself needs an on-device Expo Go run — simulators have no camera.
- Play-order graph *editing* is web-only; mobile flattens the graph to an ordered list.
- **The graph opens read-only** (phase 16). It used to be permanently
  editable, which meant the only thing clicking a game could do was drag it —
  and a stray drag silently PUT a new layout. A click now opens the game (your
  copy if you own it, `/add?q=<title>` if you don't, the same rule the list
  rows follow); "Arrange" turns dragging, connecting and arrow-deletion back
  on. Someone else's published collection has no Arrange at all. The **List**
  tab is first and default: a numbered run is what most people open a
  collection for.
- **A collection has two views, and two orderings to match.** The graph answers
  "what branches into what" (`position_x/y` + `collection_links`); the list
  answers "what's 1, 2, 3" (`collection_games.sort_order`, migration 0016).
  They're deliberately independent — `PUT /:id/layout` only writes positions
  and links, `PUT /:id/order` only writes `sort_order` — so rearranging the
  graph can't scramble a numbered run you set by hand. Migration 0016
  backfills `sort_order` from the existing layout (top-to-bottom,
  left-to-right) so "Custom order" doesn't open as a jumble on collections
  that already had a deliberate arrangement.
- The list's other sorts (title, release date, time to beat) are derived, and
  games missing the field sink to the bottom rather than sorting as zero —
  an unknown release date isn't "the year 0". Reordering is only offered on
  "Custom order", because a drag while sorted by title has nowhere to save to.
- Tapping a row in the list view opens the game: **your** copy when you own it,
  the add-game search when you don't (web passes `?q=<title>`, which is why
  `/add` has a `validateSearch`). Rows stop being tappable while you're editing
  the order — a mis-tap that navigates away would lose the whole draft.
- **`GET /api/collections/:id` is owner-or-public**, not owner-only: browsing
  the public list is pointless if you can't look inside before copying.
  `userGameId`/`status` on each node resolve against *whoever is asking*, so a
  visitor sees which of the games they own, not which the author owns.
- **Finding a public collection searches the games inside it.** `q` on
  `GET /api/collections/public` matches the collection's name and description
  *and* the titles of its games, because nobody hunting for a Zelda marathon
  knows it's filed as "Hyrule run". `gameId` is the exact-match form a game's
  own page uses for its "In public collections" block. Score is a scalar
  subquery so `sort=top` orders and paginates in the database rather than over
  one page's worth of rows.
- **`POST /api/collections/:id/add-to-library`** pulls a whole collection in at
  once, which is the point of browsing someone else's. Works on any collection
  you can see (yours or public). Games you already own count as `skipped` and
  keep their category — but the chosen platform *is* applied to them, the same
  rule `POST /api/library/bulk` follows, because "I own this marathon on
  Switch" is true of the ones you already had. An optional `gameIds` narrows
  it to some of the collection's games; it can only narrow — an id that isn't
  in the collection is ignored, so the route can't add arbitrary games.
- **A collection page offers the games you don't have** (`MissingGamesBar`,
  above the List/Play order tabs, on yours and on public ones): *Add all to
  Wishlist*, *Add all to Backlog*, *Add all to… ▾* for every other category
  (custom ones included), and *Choose games*, which turns the list's
  not-owned rows into checkboxes and points the same three controls at the
  ticked ones. It always sends explicit `gameIds` — only the games you're
  missing — so a bulk "wishlist the rest" never touches your own copies, which
  the whole-collection form would re-platform. Choosing switches to the list
  view and cancels reordering; the graph has nothing to tick. Mobile gets one
  sheet instead (`AddMissingSheet`): every missing game ticked and Wishlist
  picked, so "add all to wishlist" is still one tap. The older *Add all to
  library* popover on public browse cards and the game page's "In public
  collections" block is unchanged — it doesn't know which games you own.
- Adding from a collection is **one click with no confirm**, like the rest of
  the app's bulk adds. The count is on the button while choosing, and the
  result line says how many were added and how many were already yours.
- **Collections publish and adopt like checklists do** (migration 0015:
  `collections.is_public`, `adopted_from_id`). Adopting takes a **deep copy** —
  games, node positions and play-order links — not a live reference: your edits
  mustn't reach the original, and the author rearranging their order mustn't
  rearrange a marathon you're halfway through. A copy starts private (
  publishing someone else's list is their call) and gets `(2)`, `(3)`… appended
  if the name is taken, since `(user_id, name)` is unique. `adopted_from_id` is
  `on delete set null`, so provenance survives the source being deleted.
- **A collection can list games you don't own.** `POST /api/collections/:id/games`
  takes `igdbId` as well as `gameId` and pulls the game into the shared catalog
  via `upsertGameFromIgdb` — deliberately *without* adding it to your library,
  because "the Zelda games in order" is a reading list, not an inventory.
  `CollectionNode.userGameId` is null for those, which is what the UI uses to
  say "not in library".
- **Play times are per-user** (`user_time_to_beat`, phase 16). They used to be
  written straight onto the shared `games` row — a game's length is a fact
  about the game — but on a public app that meant one person's typo became
  everyone's number and there was nothing left to average. `resolveTtb`
  (`packages/shared/src/progress.ts`) decides what a game shows: the catalog
  row when it has anything, then your own submission, then the average of
  everyone else's. `'yours'` and `'community'` are **computed** `ttbSource`
  values that never hit the database, which is why the pg enum is still two
  values wide. Values are seconds and `normalizeTtb` still enforces
  main ≤ main+extras ≤ completionist.
- **Anything reading a play time must go through `resolveTtbFor`**, not
  `games.ttb_main`. `entryToJson`, `GET /api/library/:id/progress` and the
  dashboard's backlog total all do; a fourth reader that didn't would quietly
  disagree with the other three.
- Legacy `games.ttb_source = 'manual'` rows still win over everything, since
  they predate per-user submissions and nobody knows who wrote them. The only
  way to clear one is to submit and then clear your own figure for that game —
  `PUT /time-to-beat` treats an all-null submission as "and drop the stale
  manual override too". Nothing else writes `games.ttb_*` any more.
- Community ratings need **3 raters** before an average appears
  (`MIN_RATINGS`). That's a privacy floor, not a quality one: with one or two
  raters and a friends list, an "average" is one identifiable person's
  opinion. Play times publish from **one** submission — how long a game took
  is a fact someone measured, not an opinion about them — and the UI says how
  many players it averages.
- `GET /api/games/:gameId/community` is deliberately its own request rather
  than fields on `GET /api/library`: one query pair per detail page beats
  weight on the app's hottest route. The trade is that library cards can't
  show a community score without a new endpoint.
- UPCitemdb trial tier is ~100 lookups/day per IP (results cached in-process); a paid
  key or alternate provider is the upgrade path if scanning whole shelves.
- **Retail listings are not game titles** (`services/product-title.ts`):
  "Pokemon Sun Nintendo 09109480" used to go to the matcher verbatim because
  only the platform was ever stripped. Now the platform, a 5+ digit SKU (four
  digits stays — "Metro 2033", "NBA 2K24"), edition/condition words and
  corporate suffixes come off. **Publishers are deliberately *not* stripped
  from the confident result** — "Nintendo Land" and "Sega Bass Fishing" are
  real titles — they become `variants`, and `lookupUpc` keeps whichever scores
  better against IGDB, the same trick `matcher.ts` uses for OCR junk. Platform
  aliases are word-bounded now; without that the "nes" alias turned
  "Chinese Chess" into "Chi e Chess". `pnpm --filter @gm/api check:titles`
  runs the cases (18 of them, no DB needed).
- Steam import leftovers resolved through the review UI don't get `steam_app_id`
  linked (review's bulk-add path has no item context) — those games won't sync
  achievements until matched confidently on a later import.
- Steam achievements sync needs the profile's "Game details" privacy set to Public;
  the whole flow is untested against a real Steam account (needs a key + linked
  account — endpoints verified with mocked-level checks only).
- Custom categories are **web-only to manage**; mobile renders them via
  `statusStyle()` in `lib/ui.ts`, which falls back to a neutral chip for any
  key it doesn't know. Mobile still shows only the built-in filter chips.
- Consoles are **web-only to manage** — mobile's `consoles.tsx` lists what you own
  (storefronts nested under their platform) and each card opens
  `console/[platformId]`, but adding and removing is still web-only.
- **The 3D box viewer is gone** (phase 20), and so is everything that fed it:
  `BoxViewer3D.tsx`, `services/boxart.ts`, `case-colors.ts`, and `boxArtSrc`
  /`boxArtW`/`boxArtH` on `OwnedPlatform`. Worth knowing why it was cheap to
  remove: `boxart.ts` had already been dead since the virtual shelf went in
  phase 11 — nothing called `ensureBoxArt`, so `GET /api/library` was joining
  a table that only ever got rows written to it by a code path that no longer
  ran. Physical/digital ownership is untouched. `game_box_art` is **left in
  place, not dropped**: its rows point at `images` rows whose files are still
  on the volume and there's no orphaned-image cleanup job, so dropping it
  would strand data rather than reclaim it.
- Console logos come from IGDB and are **hot-linked**, not cached in
  `/data/images` like covers. Platforms IGDB doesn't know (the PC storefronts,
  Switch 2) have no logo at all — upload your own art, or live with the
  abbreviation in a box.
- Sub-platforms are **one level deep and PC-only** in practice. Nothing stops
  seeding a child elsewhere, but the UI assumes a two-level picker, and the
  rollups (`withParents`, the library filter, `storefrontCount`) only ever look
  one hop up.
- A game can be filed under both PC and one of its storefronts at once; the
  rollups de-duplicate by entry, so counts stay honest, but the card will show
  both badges. Nothing prevents or tidies that — it's a legitimate "I own it on
  Steam and GOG" state.
- Curated platform summaries in the seed are **authoritative**: re-running
  `pnpm db:seed` overwrites anything IGDB filled in. That's deliberate (IGDB's
  platform summaries are usually empty or dry) but it does mean edits belong in
  `scripts/seed.ts`, not the database.
- Badge opacity is one number for every category — there's no per-category
  opacity, and it deliberately floors at 20% so a badge can't vanish. The chip
  is a dark plate of the category's own hue rather than a light tint: badges
  sit on cover art, where a tint reads as broken rather than subtle.
- The library's category chips hide categories with no games (the one you're
  filtering by stays, so you can always click back out). The bulk-edit "Set
  status" row still lists them all — you need to be able to move games *into*
  an empty category.
- **`preferences.default_library_filter`** (migration 0025) is the category the
  library opens on — a built-in key, a custom category id, or the string
  `'all'`. `'all'` is a sentinel, not a category, so the preferences route
  short-circuits it before `isValidCategory`; everything else is validated the
  same way `defaultStatus` is, which is what scopes a custom id to its owner.
  The library holds it as `filterDraft ?? prefs.defaultLibraryFilter`, the same
  null-until-you-touch-it trick `libraryColumns` uses: picking a chip overrides
  the default for that visit only, and clicking **All** is a real choice rather
  than a reset, so it can't be confused with "follow the preference". Leaving
  the page drops the draft, which is what makes it a *default* rather than
  sticky state. Deleting a custom category resets it to `'all'` alongside
  `defaultStatus` (`routes/categories.ts`) — a filter pointing at a category
  that no longer exists would open to nothing with no chip to click out of.
  Pointing it at an *empty* category is allowed and isn't a dead end: the chip
  row keeps the category you're filtering by even at zero.
- The default library filter is **web-only**. Mobile's library types its filter
  as `GameStatus | "all"` and renders built-in chips only (same reason custom
  categories are web-only there), so it ignores the preference rather than
  half-applying it.
- Wikimedia Commons results are a plain text search: the odd unrelated file
  turns up, and the picker says so rather than pretending otherwise.
- Steam import rules are per user and keyed by appid. Blocking doesn't remove
  a game that's already in the library — it only stops the next import from
  putting it back.
- Migration 0013's Steam backfill only moves games it can *prove* came from
  Steam (they carry a `steam_app_id`). Anything else you filed under plain PC
  stays there — a bulk platform edit in the library's select mode is the fix.
- Console art and game covers are browsable and uploadable on **both** apps now
  (mobile uses `expo-image-picker` for the upload and the same
  `getConsoleArt`/`getCoverOptions` endpoints for browsing).
- **Cover browsing** (`services/steamgriddb.ts`) needs a free SteamGridDB key in
  admin Settings (`steamgriddb_api_key`, DB-first with `STEAMGRIDDB_API_KEY`
  fallback). No key = `configured:false` and the browser hides itself rather
  than erroring. `POST /api/library/:id/cover/from-url` **allowlists
  steamgriddb hosts** — it downloads server-side, so without that check it
  would be an open proxy for fetching arbitrary URLs.
- Pasting an image (Ctrl+V) on the Import page is web-only, and asks whether
  it's a launcher screenshot or a shelf photo rather than guessing — the two
  take different OCR paths.
- List authoring is web-only on mobile: ticking entries, voting and copying
  work, but creating, editing, reordering and publishing a list don't.
- Friends on mobile (`friends.tsx`, `friend/[userId].tsx`) does everything the
  web page does except copy-to-clipboard: React Native dropped `Clipboard` from
  core and no clipboard package is installed, so the code is selectable text
  plus a `Share` sheet.
- Friend requests have no notification: an incoming request is only visible by
  opening the friends page.
- A friend's library shows status/rating/platforms/100%%, never notes. If more
  gets exposed later, `routes/friends.ts` is the single place that decides.
- **Wiki mission scraping is gone** (phase 16). It was measured on 6 games:
  GTA V (74 missions) and RDR2 (51) correct, MGSV correct but incomplete (the
  wiki only documented 19), Halo CE returned enemy names, Mass Effect 2 and
  Resident Evil 4 found nothing. Every wiki lays mission pages out
  differently, and a scraper that is wrong more often than right cost a
  Cloudflare-fronted dependency, a rate-limit bucket and a review UI to save
  nobody any typing. Pasting a list is the create path now, and publishing one
  means the next person doesn't retype it. Don't reintroduce it — if lists
  ever need a source again, the honest version is an import format, not a
  guess. `checklist_templates.source_url` survives for CC-BY-SA attribution on
  lists scraped before the removal; nothing writes it.
- Time estimate divides the TTB figure evenly across missions — real missions vary
  a lot, and no source gives per-mission timings.
- Mission list *editing* (rename/reorder/add/delete/chapter) is web-only; mobile
  ticks entries off, votes and copies, but can't change a list. Entry reordering
  swaps the two rows' stored positions rather than renumbering the list, so it
  relies on positions being distinct — true for imported lists. **List**
  reordering (`PUT /api/games/:gameId/checklists/order`) rewrites the whole
  array instead, because lists get created and deleted often enough that
  distinct positions can't be assumed.
- **One main-story list per game, unlimited extras.** `kind='missions'` is the
  timed one — the only kind `missionCountsByGame` and the progress route look
  at — and a second is refused with a 409, since two would mean two answers to
  "how much is left". `kind='side_quests'` is every other list you keep
  (collectibles, endings, side quests), untimed by design, ordered by
  `position`. `kind='completion'` was folded into `side_quests` by migration
  0020 and now backs nothing, like `game_status`.
- The 409 on a second main-story list also fires on **adopt**: copying
  someone's main story list when you have your own is refused rather than
  filed as an extra, which would silently change what you copied it for.
  Delete yours first. Legacy duplicates from before the rule still exist,
  which is why the estimate keeps its own oldest-wins tiebreak.
- **Chapters are `checklist_items.category`** — no separate table, and a chapter
  exists only by being named on a mission, so there's no empty-chapter state to
  keep in sync. Mission numbering stays continuous across chapters, and chapter
  sections collapse with their own done/total count.
- **`checklist_templates.sequential`** (main story only): ticking entry N also
  ticks 1..N-1 in one `PUT /api/checklists/:id/items/check` call — 70 missions
  would otherwise be 70 requests. Unticking clears *only* that entry, so a
  skipped mission stays a gap; that asymmetry is deliberate, not a bug.
- The Progress tab's estimate uses the *oldest* mission checklist for a game if
  several exist; there's no picker. `missionCountsByGame` in `routes/library.ts`
  applies the same rule for the list payload — keep the two in step. New
  duplicates are refused (see the 409 above), so this only covers rows that
  predate phase 16.
- **Publishing re-scans, not just the field you changed.** `PATCH` with
  `isPublic: true` runs `inspectAll` over a list's title *and* every entry (or
  a collection's name and description), because content written before the
  filter existed would otherwise reach the public list on an isPublic-only
  request. Everything else is checked per write.
- **`services/content-filter.ts` is deliberately narrow**: hate terms and PII
  (emails, phone numbers, street addresses), not profanity. Games ship
  missions with swearing in the title and "Kill the bastard" is a fair
  description of a boss. Every term added to `HATE_TERMS` is a title someone
  can no longer write, so resist padding it — "kill all" is absent on purpose,
  since "Kill all the guards" is an actual mission in a lot of games. The
  street-address pattern skips ordinary-English suffixes (`way`, `place`,
  `st`) for the same reason: numbered mission lists are full of things like
  "12 The Only Way Out". `pnpm --filter @gm/api check:content` covers 38
  cases, most of them things that must *not* be blocked. It's a speed bump,
  not a guarantee; admin delete is still the backstop.
- **Votes are aggregated on read**, never denormalised onto the parent row — a
  counter drifts the first time a delete cascades. Public rows only, never
  your own (the control isn't rendered *and* the API refuses it), and a vote
  isn't carried across an adopt: a copy starts at zero.
- Mobile's library has no "Estimated shortest" sort (web-only), though
  `LibraryEntry.estimatedRemainingSeconds` is available to it. Sort moved into
  an `Alert` picker rather than a fifth row of chips — the four sort buttons
  used to share the search row and squeezed the field to a sliver.
- Mobile's barcode scanner **batches**: a scan queues a game and the camera
  resumes, and nothing is written until you confirm the batch. Confirming is one
  `POST /api/library` per game, not `bulk` — each scan carries its own platform
  hint from the UPC title, which `BulkAddItem` can't express. A 409 from a game
  you already own is counted as a duplicate, not an error. The queue is
  in-memory, so leaving the screen loses it.
- The import review's "pick the right game" is an `Alert` with up to six
  buttons; **Android's dialog only renders three**. It's fine on the iPhone this
  is developed against, so it's left alone — but new mobile controls shouldn't
  reach for a multi-button `Alert` (the library's sort cycles a button instead).
- Mobile screens pad their bottom with `useSafeAreaInsets()` (expo-router
  already mounts the `SafeAreaProvider`); the navigator is pinned to a dark
  theme because every screen paints its own zinc-950 background and following
  the system scheme gave a white header on a light phone.
- **Mobile styling goes through `lib/theme.ts` + `components/ui.tsx`.** Every
  entry in the `type` scale carries an explicit `lineHeight` (~1.4×): without
  one, React Native sizes a line from the font's own metrics, clipping
  descenders in tight rows and cropping emoji outright. Screens hand-rolling a
  bare `fontSize` is what caused the "text and emoji cut off" bug, so new text
  should use `type.*` rather than a local `fontSize`.
- **UI icons are `@expo/vector-icons` (Ionicons), not emoji.** An icon-font
  glyph centres predictably in its box and takes a colour; emoji did neither,
  and no line height reliably contained them. The dependency ships with the
  Expo SDK — it's pinned to 15.1.1 to stay in step with SDK 54.
- **Don't wrap a styled `Pressable` in `<Link asChild>`.** The link clones its
  child and wins the `style` prop, so sizing silently doesn't apply — that's
  how the header's account button ended up a 24pt box jammed against the screen
  edge instead of a centred 40pt square. `_layout.tsx` pushes the route with
  `useRouter()` instead.
- **The library filters by sheet, not by chips.** Seven categories plus one
  entry per console is more than a phone row holds, and two scrolling chip bars
  read as cramped. `Sheet`/`SheetButton`/`OptionRow` (`components/ui.tsx`) give
  one "All games" button and one sort button; the sheet lists everything with
  counts and 44pt rows. Empty categories *are* listed there — the sheet has the
  room the chip bar didn't, and it shows the category exists. Two active
  filters collapse the button label to "2 filters" because naming both
  overflows it.
- The library screen is the **only** one with a header button: it's the account
  hub, top left, and that hub already links to consoles, friends, collections,
  tags, scanning and import. A second cluster of header icons on the right was
  duplicating it.
- Running the mobile app under `expo start --web` renders and is useful for
  measuring type metrics, but **React Query's persisted cache doesn't rehydrate
  there**, so data-backed screens sit empty. Auth works (better-auth's expo
  client defers to the browser cookie jar on web). Treat web as a layout
  harness only; real verification is Expo Go on a device.
- **The demo is not seeded automatically.** Docker boot runs migrations and
  the platform seed only; building the demo is a deliberate step, so a
  self-hosted instance doesn't get a stranger's fake library and an IGDB
  fetch storm at first boot. Two ways to do it: `pnpm db:seed-demo`, or the
  **Build the demo library** button on `/admin/demo`. Re-run either any time
  — it wipes the demo accounts' rows and rebuilds them from the curated list
  in `services/demo-seed.ts`, and never touches a real account.
- **The Demo button is always shown**, even when nothing is seeded. It used
  to hide itself, which read as careful and behaved as a trap: an admin who
  hadn't built the demo saw no button, no explanation and nothing to click.
  `/demo` explains an unbuilt demo instead, and points admins at
  `/admin/demo`.
- **There is no demo-content editor, on purpose.** `x-gm-demo-edit` makes
  every route act on the demo account while keeping the admin's own role, so
  curating the tour uses the real Library, Collections and Progress screens.
  A bespoke editor would be a second copy of twenty screens and would be
  wrong within a phase. Two consequences worth remembering: the header is
  honoured **only for a session that is already an admin** (that check is the
  only thing between it and an account takeover), and it is a *different*
  header from the tour's, so the view-only hook never fires on it.
- **Rebuilding the demo discards editing.** `seedDemo()` deletes and rebuilds
  from the code, so a session of hand-curation is gone. `/admin/demo` warns
  before it, and that's the whole undo story — curated changes are not
  written back to `demo-seed.ts`.
- The demo seed is **slow and runs in the background** (~2 dozen IGDB lookups
  behind a ~3 req/s throttle). `POST /api/admin/demo/seed` returns 202 and
  the page polls; a second click while one runs is a 409, not two racing
  seeds. Progress lives in a module-level object, so it resets on restart —
  a rebuild interrupted by a deploy leaves the data half-built and the
  progress gone. Re-run it.
- **Everything that makes the demo view-only is the `onRequest` hook in
  `server.ts`.** Routes deliberately know nothing about it: a demo visitor is
  the seeded account as far as every handler is concerned, and the only thing
  separating that from an account takeover is that they can't send anything
  but a GET. Don't add a demo carve-out to a route — if something needs to be
  writable in the demo, that's a change to the hook, in one place, on purpose.
- Demo accounts are **excluded from four aggregates**: the first-user-becomes
  -admin count (`auth.ts`), community rating and play-time averages
  (`notDemoUser` in `services/demo.ts`), the activity log that feeds DAU, and
  the analytics user/entry totals. A fifth would be easy to miss — `is_demo`
  is the flag to reach for.
- The demo's **friend codes are hand-written** in `seed-demo.ts` and must use
  the ambiguity-free alphabet from `services/friends.ts` (no O/0, I/L/1, S/5,
  B). `normalizeFriendCode` rejects anything else, so a sloppy seeded code
  renders on screen as something nobody can type back in.
- Demo state is **sessionStorage, not a cookie or a URL param**: it has to
  survive in-app navigation, must not survive the tab closing, and must never
  ride along on a real signed-in session in another tab. `/demo` sets it and
  clears the query cache; "Exit demo" does the reverse.
- The landing page was audited against the code in phase 18. **If you remove a
  feature, `Landing.tsx`, `FeatureShowcase.tsx` and `Faq.tsx` are the three
  files that will still be claiming it** — that's how "mission lists imported
  from community wikis" outlived the scraper by two phases. `Faq.tsx`'s items
  also feed the FAQPage structured data, which Google treats a mismatch in as
  a violation.
- **`/catalog/$gameId` is a game you don't own**, and it redirects to
  `/game/$id` the moment you do — one game you own must not have two URLs.
  It's deliberately thinner than the owned page: no rating, notes, tags,
  platforms or lists, because all of those are per-user state that doesn't
  exist yet. Adding uses your default category and platform unless you say
  otherwise, then lands you on the real page.
- Feedback is **web-only**. Mobile has no Feedback screen and no admin queue —
  `POST /api/feedback` is there if it ever gets one.
- **Feedback isn't content-filtered**, unlike lists and collections. It's a
  private channel to the operator, and rejecting a bug report over its wording
  loses the report. It is rate-limited (10 per 10 minutes) and attributable.
- Deleting an account **keeps its feedback** (`user_id` is
  `on delete set null`): the bug doesn't leave when the reporter does. The row
  stops being attributable, which is the intended trade — the admin table then
  shows "—" for who sent it.
- The admin feedback table pages at 100 rows and says so; **CSV export takes
  the whole matching set** (capped at 5000), **PDF export takes the page you're
  looking at**. PDF is a printable window handed to the browser's print dialog
  rather than a generated file — "Save as PDF" is a destination there, and it
  keeps a PDF library out of the dependency tree. A blocked popup silently does
  nothing; the CSV link next to it is the fallback.
- Feedback `kind`, `area` and `status` are **text validated by zod**, not pg
  enums — same reasoning as `user_games.status`. Adding a triage state is a
  constant in `packages/shared/src/schemas/feedback.ts` and nothing else.
- The Progress tab's **Browse public lists** panels filter the *same* fetched
  set by kind: the main-story section only offers `kind='missions'`, the extras
  section only offers everything else. Copying someone's main story into your
  side-quest pile isn't a thing anyone means, and adopting a main story list
  when you already have one is a 409 the panel surfaces.
- **Icons are generated, not hand-drawn per size.** Edit
  `apps/web/public/icon.svg`, then run `node apps/web/scripts/generate-icons.mjs`
  — nothing in the build does it for you, and a stale `favicon.ico` next to a
  fresh SVG is the failure mode. The script leans on `sharp` resolving from the
  workspace root (`.npmrc` sets `node-linker=hoisted` for Expo), so it isn't a
  web dependency and won't survive a switch to isolated linking.
- **Two-factor is TOTP only, and setup is web-only.** Mobile can *answer* the
  challenge (and must — `twoFactorClient()` is in `apps/mobile/src/lib/auth.ts`
  for exactly that reason) but can't turn it on or regenerate backup codes.
  There is no emailed-code fallback on purpose: `email_from` is optional on a
  self-hosted instance, and a second factor that depends on unconfigured mail
  is a lockout with extra steps.
- A trusted device is a **cookie, not a device record**. Clearing site data,
  a fresh browser profile or a private window all count as a new device, and
  there is no "sign out everywhere / forget my devices" control — turning 2FA
  off and back on is the blunt instrument. 30 days is `trustDeviceMaxAge` in
  `auth.ts`; the Preferences copy quotes that number, so change both.
- **Backup codes are shown once per set**, but "New backup codes" issues a
  fresh set (`generateBackupCodes`) and voids the old one, so losing the list
  isn't a lockout. It skips the scan step — the secret is untouched, only the
  codes change. Losing the list *and* the phone still means clearing
  `two_factor` and `user.two_factor_enabled` by hand.
- **2FA is verified against the API but not against a real phone.** Enable →
  scan → verify → sign in from a cold jar → backup code → regenerate → disable
  were all exercised against Postgres, with TOTP codes computed from the
  issued secret, and the QR's own secret round-tripped (a code derived from
  what the QR encodes was accepted). What nobody has done is point Google
  Authenticator at the picture. Keep a backup code to hand the first time.
- **Sign-in rate limiting shares one bucket** in dev: better-auth logs
  "could not determine a client IP and is falling back to a single shared
  per-path bucket" on every sign-in, so the 5/min limit is global rather than
  per-IP. Pre-existing, and it bites in testing (five curl sign-ins lock the
  browser out for a minute). Behind Traefik it needs
  `advanced.ipAddress.ipAddressHeaders` set for the limit to be per-client;
  until then it's a self-DoS risk, not a bypass.
- **Never interpolate a bare column into a correlated subquery.** Drizzle
  emits an *unqualified* `"id"` for a column inside a `sql` template when the
  outer query has no join, and Postgres binds a bare name to the innermost
  scope — so `… FROM "session" WHERE "user_id" = "id"` compares two of
  `session`'s own columns and returns zero, silently. `admin-users.ts` has a
  `qualified(table, column)` helper for exactly this and uses it on every
  reference. The scalar subquery in `routes/collections.ts` is currently safe
  only because `collection_votes` happens to have no `id` column — adding one
  would break it without any error.
- The admin **Users tab is read-only**. It lists accounts and what each has
  done; it can't ban, promote, reset a password or delete. Those need
  confirmation flows and an audit trail, and they're the rest of the phase 6
  admin panel. `GET /api/admin/users` has no write sibling, deliberately.
- "Last active" on that tab reads `analytics_events`, which only started
  logging in phase 14 and has **no retention job** — an account quiet since
  before then shows a dash rather than a date, and if a prune ever lands it
  must keep enough `activity` history for this column to mean anything.
- A friend's game card links to **your** copy when you own it, using
  `myUserGameId` from `GET /api/friends/:userId/library` — that field is the
  reason the route selects `user_games.id` for the asking user and not just
  the game ids. Games you don't own go to `/catalog/$gameId`, which is
  owner-agnostic; nothing about the friend rides along, so adding from there
  files it under *your* defaults, not theirs.
- Mobile has **no catalog screen**, so a friend's game you don't own opens
  `/add?q=<title>` — a search with the name pre-typed, one tap from the same
  result. `add.tsx` reads `q` for this; the collections screen still pushes a
  bare `/add` and could use the same treatment.
- **The library grid holds its order while you quick-edit, and only then.**
  `heldOrder` is a snapshot of the ids on screen, taken when a quick-actions
  panel opens; while it's set, those cards keep their slot and stay visible
  even once an edit stops them matching the filter. It clears when you press
  *↻ Re-sort* or change anything about the view (filter chip, platform, tag,
  sort, search, select mode) — a held order that survived a filter change
  would be showing you the last view's answer.
- **Quick actions did not touch the default-library-filter draft.** Leaving
  the page still drops it, deliberately (see `preferences.default_library_filter`
  above) — the fix for "I lost my place" is that filing a game no longer
  requires leaving the page, not that the page remembers where you were.
- Quick actions are **web-only**. Mobile's library card opens the game, and
  its detail screen is where category, rating and tags are edited; there's no
  equivalent panel and no `offFilter` hold.
- **The quick panel is `position: fixed`, not absolute.** A card sets
  `overflow-hidden` to keep its cover's corners rounded, so a popover inside
  one would be sliced; fixed positioning escapes that (no ancestor uses a
  transform, which would make it a containing block again). `useAnchoredStyle`
  owns the placement and re-runs on scroll, resize and its own resize.
- **`GET /api/collections` takes an optional `?gameId=`** and adds
  `containsGame` to each row. Membership is asked for on the collection list
  rather than through a route of its own so the picker gets names, counts and
  membership in one request; the field is *absent* without the parameter, so
  `false` always means "asked, and no". It's scoped to your own collections
  before the membership query runs, so it can't be used to probe anyone else's.
- Filing a game into a collection is offered on your library card, the game
  page and `/catalog/$gameId`, but **not from a friend's library** — that page
  deliberately exposes as little as it can, and the game's own page is one
  click away.
