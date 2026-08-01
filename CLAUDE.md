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
- **PC storefronts are platforms**: Steam, Epic, GOG, Battle.net, EA App, Ubisoft
  Connect, Microsoft Store and itch.io sit in the `pc` family alongside the generic
  **PC**, which stays for "where I bought it doesn't matter". Steam imports file
  games under **Steam** (matched by name, not IGDB id — storefronts have none).
- **jsonb only for display config** (dashboard layout, status colors) — everything else
  that v1 stored as JSON strings is normalized tables here.
- **One funnel for category badges**: `statusChip()` (`apps/web/src/lib/format.ts`)
  resolves colour *and* applies `preferences.badge_opacity`, so the opacity setting
  lands on every badge on every page for free. Mobile mirrors it through
  `statusStyle(status, opacity)` in `lib/ui.ts`.
- **Real box art** (`services/boxart.ts`): physical games fetch genuine retail box-front
  scans from libretro-thumbnails (21 retro platforms; validated repo names). Dedup
  pointer files are followed; PNG dims parsed from IHDR; misses recorded in
  `game_box_art` so they aren't retried. Boxes render at true retail mm dimensions
  (`BOX_SPECS` in `packages/shared/src/case-colors.ts` — N64 is landscape!) and adopt
  the scan's exact aspect. Modern platforms (Switch, PS4+, Xbox One+) have no scan
  archive → synthesized banner case. 3D spin viewer: `apps/web/src/components/BoxViewer3D.tsx`.

## Commands

```bash
docker compose -f deploy/docker-compose.yml up -d   # dev Postgres
pnpm db:migrate && pnpm db:seed                      # migrations + platform seed
pnpm dev:api   # :3001 (tsx watch)
pnpm dev:web   # :5173 (proxies /api → :3001)
pnpm dev:mobile  # Expo Go; needs EXPO_PUBLIC_API_URL=<LAN IP> in apps/mobile/.env
pnpm --filter @gm/api db:generate   # after schema changes → new SQL migration
pnpm --filter <pkg> typecheck       # per-package tsc
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

**Next: Phase 6 (skipped for now, still open)** — email verification/password reset
(better-auth config flip + SMTP), data export (JSON/CSV), backlog randomizer with
filters, admin panel (users, password resets, registration toggle, settings).
**Deployment to Bryan's Ubuntu/Portainer server is the current focus** (v1's compose
file to be provided for reference).

## Deferred / known gaps

- Light theme (preference stored, no light stylesheet) — Phase 6.
- Email verification / password reset — Phase 6 (better-auth config flip + SMTP).
- Shelf photos of physical games are untested against real photos; tesseract can't read
  spines — needs `ANTHROPIC_API_KEY` (vision) for good results.
- Severely mangled OCR ("sonELAB" for BONELAB) won't auto-match — by design, the review
  UI's re-search covers it.
- Orphaned image cleanup job not yet written (images accumulate on the volume).
- `import_jobs.status='done'` cleanup/pruning not implemented.
- Barcode scan flow verified end-to-end at the API level (real BOTW/GoW barcodes) but
  the camera screen itself needs an on-device Expo Go run — simulators have no camera.
- Play-order graph *editing* is web-only; mobile flattens the graph to an ordered list.
- UPCitemdb trial tier is ~100 lookups/day per IP (results cached in-process); a paid
  key or alternate provider is the upgrade path if scanning whole shelves.
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
  with logo, release date, summary and a cover preview, but can't add or remove.
- The 3D box viewer and `services/boxart.ts` outlived the shelf: box scans are
  still fetched, but only lazily from `GET /api/library` (the shelf used to be
  what warmed them), and the viewer now lives only on a game's detail page.
- Console logos come from IGDB and are **hot-linked**, not cached in
  `/data/images` like covers — a handful of small PNGs wasn't worth an
  `image_kind` enum value and a download path. Platforms IGDB doesn't know (the
  PC storefronts, Switch 2) fall back to their abbreviation in a box.
- Curated platform summaries in the seed are **authoritative**: re-running
  `pnpm db:seed` overwrites anything IGDB filled in. That's deliberate (IGDB's
  platform summaries are usually empty or dry) but it does mean edits belong in
  `scripts/seed.ts`, not the database.
- Badge opacity is one number for every category — there's no per-category
  opacity, and it deliberately floors at 20% so a badge can't vanish.
- Steam import files games under **Steam**, but games imported before this change
  are still on **PC**; nothing rewrites them. A bulk platform edit in the library's
  select mode is the fix if that matters.
- **Cover browsing** (`services/steamgriddb.ts`) needs a free SteamGridDB key in
  admin Settings (`steamgriddb_api_key`, DB-first with `STEAMGRIDDB_API_KEY`
  fallback). No key = `configured:false` and the browser hides itself rather
  than erroring. `POST /api/library/:id/cover/from-url` **allowlists
  steamgriddb hosts** — it downloads server-side, so without that check it
  would be an open proxy for fetching arbitrary URLs.
- Pasting an image (Ctrl+V) on the Import page is web-only, and asks whether
  it's a launcher screenshot or a shelf photo rather than guessing — the two
  take different OCR paths.
- Checklist authoring is web-only on mobile (tracking + adopting work).
- Friends is web-only — mobile has no friends screen yet, though the API is
  shared and ready for one.
- Friend requests have no notification: an incoming request is only visible by
  opening the friends page.
- A friend's library shows status/rating/platforms/100%%, never notes. If more
  gets exposed later, `routes/friends.ts` is the single place that decides.
- **Wiki mission scraping is best-effort and often wrong.** Measured on 6 games:
  GTA V (74 missions) and RDR2 (51) correct, MGSV correct but incomplete (19 — the
  wiki page only documents 19), Halo CE picked up enemy names, Mass Effect 2 and
  Resident Evil 4 found nothing. Every wiki lays mission pages out differently, so
  the review step and the paste-a-URL / manual-entry fallbacks are the real
  interface, not a nicety. `MIN_SCORE` in `services/missions.ts` deliberately
  prefers returning nothing over returning a wrong list.
- Time estimate divides the TTB figure evenly across missions — real missions vary
  a lot, and no source gives per-mission timings.
- Mission lists can't be **published/adopted** yet, unlike completion checklists:
  `ChecklistPanel` filters to `kind='completion'`, so a public mission list would
  have nowhere to be adopted from. The tables support it (`is_public`,
  `adopted_from_id`) — it needs UI on both sides. This matters more than it
  sounds: sharing was the reason mission lists were built on checklists at all,
  so scraping is currently repeated per user.
- Mission list *editing* (rename/reorder/add/delete/chapter) is web-only; mobile
  ticks entries off but can't change them. Reordering swaps the two rows' stored
  positions rather than renumbering the list, so it relies on positions being
  distinct — true for imported lists.
- **Two list kinds per game**: `kind='missions'` (main story, timed, groupable
  into chapters) and `kind='side_quests'` (tracked, deliberately untimed — how
  much side content you do is a choice, so an estimate would be invented).
  Only `'missions'` feeds `missionCountsByGame` and the progress route.
- **Chapters are `checklist_items.category`** — no separate table, and a chapter
  exists only by being named on a mission, so there's no empty-chapter state to
  keep in sync. Mission numbering stays continuous across chapters, and chapter
  sections collapse with their own done/total count.
- **`checklist_templates.sequential`** (main story only): ticking entry N also
  ticks 1..N-1 in one `PUT /api/checklists/:id/items/check` call — 70 missions
  would otherwise be 70 requests. Unticking clears *only* that entry, so a
  skipped mission stays a gap; that asymmetry is deliberate, not a bug.
- Wiki search is offered for the main story list only: `services/missions.ts`
  denylists "side" sections, so pointing it at a side-quest list re-imports the
  main story.
- The Progress tab's estimate uses the *oldest* mission checklist for a game if
  several exist; there's no picker. `missionCountsByGame` in `routes/library.ts`
  applies the same rule for the list payload — keep the two in step.
- Mobile's library has no "Estimated shortest" sort (web-only), though
  `LibraryEntry.estimatedRemainingSeconds` is available to it.
