# Game Manager 2 — Plan & Features

A ground-up v2 of the personal game library manager. V1 is a single Next.js app; v2 is a **web app + Expo mobile app sharing one API and one account system**, self-hosted in Docker containers on a personal Ubuntu home server.

---

## 1. Overview & Goals

### What v2 is

- A **multi-user** game library tracker: each user registers with **email + password** and sees the same library on the website and the mobile app (Expo Go during development).
- **Highly customizable**: users create their own tags/categories, colors, statuses display, and shelf organization.
- **Fast bulk entry**: paste a list, upload a screenshot of a digital library, or photograph a physical game shelf — the app OCRs it, strips launcher noise, matches titles against IGDB, and lets you fix anything it got wrong.
- A **virtual shelf**: box art displayed as game boxes, grouped by the console you own them on, with physical vs digital distinction.
- **How-long-to-beat data** on every game (main / main + extras / completionist), with manual entry fallback.
- Later: **completionist checklists** (crowd-sourced templates, since no public API exists) and **achievement tracking** (Steam first).

### Lessons from v1

**Keep (worked well):**
| v1 pattern | Why it stays |
|---|---|
| Shared `Game` catalog separate from per-user `UserGame` state | Clean multi-user foundation; one game row serves everyone |
| OCR import with launcher-noise filtering + manual review step | Genuinely differentiated feature; the review step means bad OCR degrades to assisted manual entry, never garbage data |
| Local image caching (download covers once, serve locally) | No hotlinked/broken covers, works offline |
| DB-first credential resolution (admin sets IGDB keys in the UI, env as fallback) | Reconfigure without redeploying |
| Docker + Traefik + Cloudflare deploy pattern | Already proven on the server |

**Fix (hurt in v1):**
| v1 problem | v2 answer |
|---|---|
| SQLite + `prisma db push --accept-data-loss` on every boot — no migration history | PostgreSQL + versioned SQL migrations run on container start |
| JSON-encoded strings in text columns (platforms, genres, graphs, configs) — unqueryable | Normalized relational tables; `jsonb` only for genuine display-config |
| Cookie-only NextAuth — doesn't work for a mobile client | Token-capable auth (better-auth): cookies on web, bearer tokens on mobile |
| Client-side tesseract.js OCR (huge WASM bundle, can't port to Expo) | Server-side OCR endpoint both clients share |
| Username-only accounts, no email field | Email as the login identifier from day one |
| API and UI tangled in one Next.js app | Standalone API with a documented contract; web and mobile are both just clients |

---

## 2. Feature List

### 2.1 Core features (required)

**Accounts & sync**
- Register / log in with email + password; same account on web and mobile; all data lives server-side so it is always in sync.
- Roles: `admin` and `user`. First registered account becomes admin. Admin can reset any user's password (no email sending needed initially). Registration can be closed via env/setting.

**Library**
- Add games via IGDB search (title, box art, summary, genres, release date, platforms auto-filled) or fully manual entry.
- Per-game user state: status (`wishlist / backlog / playing / finished / dropped`), half-star rating (0.5–5.0), free-form notes, started/finished dates (auto-stamped on status change), custom cover override.
- **Platform ownership**: mark which platform(s) you own each game on, each flagged **physical or digital**. A game can be owned on multiple platforms at once.
- **Time to beat**: main / main + extras / completionist pulled from IGDB's community data, with per-game manual override and an "endless game" toggle (excludes it from backlog-time math).

**Customization**
- User-created **tags** with names, colors, and optional groups (e.g., a "Mood" group with *Cozy / Intense*, a "Franchise" group with *Zelda / Halo*). Filter and organize the library by any combination.
- Per-user appearance: status colors, badge toggles (platform/time), theme (dark/light), dashboard layout.

**Import**
- **Text paste / .txt file**: one title per line, bulk-matched against IGDB.
- **Screenshot import**: upload a screenshot of a digital library (Steam, Xbox app, etc.) → server-side OCR → noise-word filtering (strip "Update queued", trademark symbols, fix common OCR misreads like `il` → `III`) → title extraction → auto-match.
- **Shelf photo import**: photograph physical game spines/cases → cloud/LLM vision OCR (spines are too hard for plain Tesseract) → same matching pipeline.
- **Review step for all imports**: every matched title shown with confidence; per-item manual re-search, skip, or accept; nothing enters the library unreviewed unless you confirm-all.

**Virtual shelf**
- Visual shelf rendering owned games as boxes with box art, **grouped by console/platform family** (Nintendo shelf, PlayStation shelf, Xbox shelf, PC/Steam shelf…).
- Physical copies render as boxed cases; digital as tiles/cards — visually distinct at a glance.
- Sort each shelf alphabetically, by release date, or custom drag order.

**Dashboard & stats**
- Counts by status and platform, estimated hours to clear the backlog (via TTB), recently finished, optional "random pick" widget.

**Collections & play order** (carried from v1)
- User-defined groupings (franchises, marathons) with roll-up stats and the **visual play-order graph** (draggable nodes and edges showing what order to play a series).

### 2.2 Later-phase features

- **Completionist checklists**: per-game task lists (missions, collectibles, endings, achievements-by-hand). **No public API exists for this data** (PSNProfiles/TrueAchievements don't offer APIs), so it's user-created and **crowd-sourced inside the app**: any user can publish a checklist template for a game; other users adopt a copy and track their own progress. Admin can remove bad templates.
- **Achievement tracking**: Steam first (official Steam Web API — solid, needs the user's profile set public). Xbox via the third-party OpenXBL service and PSN via unofficial endpoints are **experimental, best-effort** later additions.
- **Email sending**: signup verification and self-service password reset once an SMTP provider is configured (better-auth makes this a config flip).
- **Admin panel**: user list, password resets, registration toggle, app settings, template moderation.

### 2.3 Idea backlog (suggested additions)

Features worth adding to the list — none are commitments yet:

| Idea | Notes |
|---|---|
| **Steam account import** | Enter your SteamID → import your whole Steam library with playtime via the official API. No OCR needed for Steam users. Falls out of the achievements work almost free. |
| **Barcode scanning** | Point the phone camera at a physical game's UPC → auto-identify and add it. `expo-camera` scans barcodes in Expo Go; lookup via UPC database with IGDB fallback. Great companion to the shelf-photo import. |
| **Wishlist price tracking** | IsThereAnyDeal has a real API — watch wishlist games for sales, show current best price. |
| **Backlog randomizer** | "Pick my next game" with filters (platform, max TTB, tag) — turns the backlog into a slot machine. |
| **Public shelf share link** | Read-only URL to show your virtual shelf to friends without an account. |
| **Year-in-review stats** | Games finished per year, hours played, ratings distribution — a personal "wrapped". |
| **Play session logging** | Optional start/stop or manual session entries to track actual hours vs TTB estimates. |
| **Data export** | JSON/CSV export of your entire library — insurance against ever being locked in. |
| **"Now playing" widget** | Home-screen widget on mobile (requires an Expo dev build, not Expo Go — later). |
| **RAWG fallback metadata** | Second metadata source when IGDB misses a title. |
| **Duplicate detection** | Warn when adding a game you already own on another platform. |

---

## 3. Architecture & Tech Stack

### 3.1 System diagram

```
                         ┌────────────────────────────────────────────┐
                         │           Ubuntu home server               │
   Browser ──────────►   │  Traefik (existing, Cloudflare TLS)        │
   gm.example.com        │   ├─ /      → [web]  nginx + static SPA    │
                         │   └─ /api   → [api]  Fastify + workers     │
   Expo app ─────────►   │                 │            │             │
   gm.example.com/api    │           [postgres]   /data/images vol    │
   (bearer token)        └────────────────────────────────────────────┘
                                    │
                              IGDB / OCR provider (outbound only)
```

### 3.2 Tech stack (one pick per decision)

| Decision | Pick | Why |
|---|---|---|
| Monorepo tooling | **pnpm workspaces + Turborepo** | Standard, low-config; cached build/lint/typecheck across all apps and packages |
| Backend | **Fastify 5** + Zod type provider | Fast, mature plugins (multipart uploads, rate limiting); Zod route schemas double as the shared API contract |
| ORM & migrations | **Drizzle ORM + drizzle-kit** | SQL-first, real enums/arrays/indexes, migrations are versioned SQL files in the repo — directly fixes v1's biggest wound |
| Database | **PostgreSQL 16** | Real migrations, full-text search for the library, and hosts the job queue too |
| Job queue | **pg-boss** | Rides on Postgres — async OCR jobs without adding a Redis container |
| Auth | **better-auth** | One config serves web (cookies) and Expo (bearer tokens in `expo-secure-store`); admin plugin gives password resets; email verification is a later config flip |
| Web app | **Vite + React + TanStack Router + TanStack Query + Tailwind CSS** | The API is separate, so Next.js buys nothing; a static SPA makes the web container a trivial nginx image; TanStack Query knowledge is shared with mobile |
| Mobile app | **Expo (latest SDK) + Expo Router + TanStack Query** | File-based routing symmetry with web; runs in Expo Go for development; NativeWind for Tailwind-style styling |
| Shared code | **`@gm/shared`** (Zod schemas, enums, types) + **`@gm/api-client`** (typed fetch wrapper, pluggable token storage) | Schemas written once validate the API, type both clients, and validate forms |
| OCR | **Server-side, pluggable provider** — default Tesseract binary baked into the API image; Google Cloud Vision or LLM-vision selectable by env for shelf photos | Both clients just upload an image; OCR runs as an async pg-boss job and clients poll job status |
| Images | Local volume `/data/images`, processed with **sharp** (resize + webp variants), served at `/api/images/:id` | v1's approach, plus thumbnail/shelf-size variants for the virtual shelf grid |
| Game metadata | **IGDB** (Twitch client-credentials OAuth), server-side only, rate-limited to 4 req/s, every result upserted into the local `games` catalog | Keys stay off clients; repeat lookups never hit IGDB; catalog powers fast import matching |

### 3.3 Monorepo layout

```
game-manager-2/
├── PLAN.md
├── package.json / pnpm-workspace.yaml / turbo.json
├── .env.example
├── apps/
│   ├── api/                     # Fastify app
│   │   ├── src/
│   │   │   ├── modules/         # auth, games, library, tags, collections,
│   │   │   │                    #   import, shelf, images, igdb, admin
│   │   │   ├── db/              # drizzle schema + migrations/
│   │   │   ├── jobs/            # pg-boss workers: ocr, igdb-enrich, image-cache
│   │   │   ├── services/        # ocr providers, igdb client, title matcher,
│   │   │   │                    #   image pipeline
│   │   │   └── plugins/         # auth guard, error handler, rate limit
│   │   └── Dockerfile           # node + tesseract-ocr binary
│   ├── web/                     # Vite + React SPA
│   │   ├── src/routes/          # TanStack Router file routes
│   │   ├── src/features/        # library, shelf, import, collections, settings
│   │   └── Dockerfile           # build → nginx:alpine
│   └── mobile/                  # Expo app
│       ├── app/                 # Expo Router routes
│       └── src/features/
├── packages/
│   ├── shared/                  # @gm/shared — zod schemas, enums, constants
│   ├── api-client/              # @gm/api-client — typed client
│   └── config/                  # shared tsconfig / eslint
└── deploy/
    ├── docker-compose.yml       # local dev (postgres only)
    └── docker-compose.prod.yml  # api + web + postgres + traefik labels
```

### 3.4 Auth design (web + mobile)

- better-auth mounted on the Fastify API, tables in the same Postgres DB.
- **Web**: standard HTTP-only session cookies. Because Traefik serves web and API from the same host (path routing), there are no CORS or cookie-domain issues.
- **Mobile**: better-auth's Expo + bearer plugins — the app stores its session token in `expo-secure-store` and sends `Authorization: Bearer …`.
- `emailAndPassword` enabled with `requireEmailVerification: false` for now. Phase 6 flips verification/reset on once SMTP is configured.
- Admin plugin: admin-only endpoints for listing users and setting a new password.

### 3.5 OCR & import pipeline

```
client uploads image (or pastes text)
  → POST /api/imports          → creates import_job, returns job id immediately
  → pg-boss worker:
      1. OCR (tesseract | google-vision | llm-vision, chosen by env/setting)
      2. Noise filter        (port v1's cleanup: launcher UI text, ™/®,
                              roman-numeral misreads, duplicate lines)
      3. Title extraction    → import_items rows (raw_text, cleaned_title)
      4. Matching            → local catalog first, then IGDB search;
                              store matched_game_id + confidence
  → client polls GET /api/imports/:id  → shows review UI
  → user fixes/skips/accepts  → accepted items become user_games
```

Text-paste imports skip steps 1–2 and reuse the same matcher and review UI — which is why text import ships two phases before OCR.

### 3.6 IGDB integration & catalog caching

- Twitch client-credentials token cached in the DB (credentials configurable in admin settings, env fallback — v1 pattern).
- Global limiter at 4 requests/second (IGDB's cap).
- Every fetched game is upserted into the local `games` catalog with cover, genres, platforms, and `game_time_to_beats` data — so imports of common games hit only the local DB.
- Covers downloaded once to `/data/images` and re-served locally.

---

## 4. Data Model

Normalized — every JSON-string column from v1 becomes real rows. The shared-catalog / per-user split is kept.

**Auth (better-auth managed):**
- `users` — id, email (unique), name, role (`admin|user`), password hash, created_at
- `sessions`, `accounts` — better-auth internals

**Shared catalog:**
- `games` — id, igdb_id (unique, nullable for manual entries), title, slug, summary, release_date, cover_image_id → images, ttb_main / ttb_main_extra / ttb_completionist (seconds, nullable), ttb_source (`igdb|manual`), timestamps
- `platforms` — id, igdb_platform_id, name, abbreviation, **family** (`nintendo|sony|xbox|pc|sega|other`), sort_order — seeded from IGDB; `family` drives virtual-shelf grouping
- `game_platforms` — game_id, platform_id (platforms a game *exists* on)
- `genres` / `game_genres` — same pattern
- `images` — id, kind (`cover|custom_cover|shelf_photo|background`), filename, mime, width, height, owner_user_id (null = shared)

**Per-user library:**
- `user_games` — id, user_id + game_id (unique pair), status enum (`wishlist|backlog|playing|finished|dropped`), rating numeric(2,1), notes, custom_cover_image_id, ttb_enabled bool, started_at, finished_at, timestamps
- `user_game_platforms` — user_game_id, platform_id, format (`physical|digital`) — the platforms you *own* it on
- `tags` — id, user_id, name, color, group_name (nullable); unique (user_id, name)
- `user_game_tags` — user_game_id, tag_id

**Collections & play-order graph:**
- `collections` — id, user_id, name, description, accent_color, bg_color, bg_image_id
- `collection_games` — collection_id, game_id, position_x, position_y (node placement)
- `collection_links` — id, collection_id, from_game_id, to_game_id, label (graph edges)

**Import pipeline:**
- `import_jobs` — id, user_id, source (`screenshot|shelf_photo|text_paste`), image_id, status (`pending|ocr|matching|review|done|failed`), created_at
- `import_items` — id, job_id, raw_text, cleaned_title, matched_game_id (nullable), confidence, resolution (`auto|manual|skipped`)

**Preferences & settings:**
- `user_preferences` — user_id PK, theme, status colors, badge toggles, dashboard layout (`jsonb` acceptable here — pure display config)
- `settings` — key/value admin config (IGDB credentials, OCR provider, registration toggle)

**Later phases:**
- `checklist_templates` — id, game_id, author_user_id, title, is_public
- `checklist_items` — template_id, position, text, category
- `user_checklist_items` — user_id, item_id, completed_at
- `linked_accounts` — user_id, provider (`steam|xbox|psn`), external_id, tokens
- `achievements` — game_id, provider, external_id, name, icon
- `user_achievements` — user_id, achievement_id, unlocked_at

---

## 5. Implementation Roadmap

Ordered so a usable app exists early: auth and a manual library land before OCR and shelf polish.

### Phase 0 — Scaffolding (foundation, no features)
- Monorepo: pnpm workspaces + Turborepo, shared tsconfig/eslint.
- Fastify app with health route; Drizzle schema + first migration; Postgres via dev docker-compose.
- better-auth wired: register / login / logout working on **both** web and Expo Go; first user becomes admin; admin password-reset endpoint.
- Vite web shell (routing, auth screens) and Expo shell (Expo Router, login screen).
- `@gm/shared` and `@gm/api-client` packages consumed by both clients.
- Seed script: platform list from IGDB, admin user.

**Exit criteria:** log into an empty app in a browser *and* in Expo Go against the same local API.

### Phase 1 — MVP library (first daily-usable version)
- IGDB search + game detail fetch, catalog upsert, cover download/caching.
- Add game to library; library list with status, half-star rating, notes; edit/remove.
- Platform ownership with physical/digital per platform.
- **Text-paste bulk import** (no OCR yet — same matcher and review UI, ships value early).
- Mobile: login, library list, game detail, add via search.

**Exit criteria:** v2 replaces v1 for day-to-day tracking.

### Phase 2 — Customization & organization
- Custom tags (colors, groups); filtering and sorting by status/platform/tag/rating.
- Library search (Postgres full-text).
- Custom cover upload; user preferences (status colors, badges, dark/light theme).
- Dashboard: counts by status/platform, backlog hours via TTB, recently finished, random pick.
- Mobile gets tags + filters.

### Phase 3 — OCR import pipeline ⚠ highest-risk phase
- Server-side pipeline: upload → pg-boss job → OCR provider → noise filtering (ported from v1) → title extraction → catalog/IGDB matching.
- Review UI: matches with confidence, per-item re-search / skip / accept, confirm-all.
- Screenshots via Tesseract; shelf photos via cloud/LLM vision provider.
- Mobile: take a photo in-app, upload into the same pipeline.
- **Prototype with real shelf photos at the start of the phase, before building UI polish.**

### Phase 4 — Virtual shelf + collections
- Shelf view grouped by platform family/console from `user_game_platforms`.
- Boxes with art; physical (boxed case) vs digital (tile) visual distinction.
- Per-shelf ordering: alphabetical, release date, custom drag.
- Port collections + play-order graph (normalized tables) from v1.
- Shelf on mobile.

### Phase 5 — Mobile polish + camera
- Feature-parity pass on mobile.
- **Barcode scanning** of physical games (`expo-camera`; UPC lookup with IGDB fallback).
- Offline-tolerant caching (TanStack Query persistence).

### Phase 6 — Accounts & quality of life
- Email sending: verification + self-service password reset (SMTP env + better-auth config flip).
- Data export (JSON/CSV); backlog randomizer with filters.
- Admin panel: users, password resets, registration toggle, settings.

### Phase 7 — Completionist checklists
- Per-game user-created checklists (missions, collectibles, endings) with progress tracking.
- Publish/share templates; other users adopt a copy. Admin moderation (delete).

### Phase 8 — Achievements
- Link Steam account (SteamID) → sync owned games, playtime, and achievements via the official Steam Web API. Side benefit: **full Steam library import without OCR**.
- Xbox (OpenXBL) and PSN (unofficial) as experimental follow-ups only if still wanted.

---

## 6. Deployment

### Containers (production)

| Container | Image / contents | Volumes | Notes |
|---|---|---|---|
| `postgres` | postgres:16-alpine | `pgdata` | Never exposed publicly |
| `api` | Node + Tesseract binary; Fastify + in-process pg-boss workers | `images:/data/images` | Runs `drizzle-kit migrate` on boot, then starts. Workers stay in-process — one household's import volume doesn't justify a separate worker container |
| `web` | nginx:alpine serving the built SPA | — | No runtime env needed; the SPA calls relative `/api` URLs |

### Routing (fits the existing Traefik + Cloudflare setup)

Single host, **path-based** routing — mirrors the label conventions already used in v1's `docker-compose.prod.yml`:

- `gm.<domain>` → `web` container
- `gm.<domain>/api` → `api` container (`PathPrefix(\`/api\`)` rule at higher priority)

Path routing means the web app and API share an origin: **no CORS, no cookie-domain configuration**. The Expo app calls `https://gm.<domain>/api` with bearer tokens, so it has no cookie concerns either.

### Environment variables

```
DATABASE_URL=postgres://gm:***@postgres:5432/gamemanager
BETTER_AUTH_SECRET=<generate fresh — do not reuse v1's committed secret>
BETTER_AUTH_URL=https://gm.<domain>
IGDB_CLIENT_ID= / IGDB_CLIENT_SECRET=     # Twitch app credentials (or set in admin UI)
OCR_PROVIDER=tesseract                    # tesseract | google | llm
GOOGLE_VISION_KEY= / LLM_OCR_KEY=         # only if provider selected
IMAGE_DIR=/data/images
ALLOW_REGISTRATION=true                   # close after household signs up
ADMIN_EMAIL=                              # first-boot admin seed
TZ=America/Chicago
```

Ship a complete `.env.example`. **Note:** v1's repo has a real `NEXTAUTH_SECRET` committed — generate fresh secrets for v2 and never commit them.

### Development workflow

- `deploy/docker-compose.yml` runs **Postgres only**; API and web run via `pnpm dev` with hot reload.
- Expo Go on the phone points at the dev machine's LAN IP via `EXPO_PUBLIC_API_URL=http://192.168.x.x:3001`.
- Backups: nightly `pg_dump` + tar of the images volume (same tar approach as v1's README).

---

## 7. Risks & Open Questions

1. **Shelf-photo OCR quality — highest risk.** Tesseract handles clean screenshots but is poor on vertical spines, mixed fonts, glare, and camera angles. Mitigations: pluggable provider (Google Cloud Vision free tier ≈1,000 images/month is plenty for personal use; an LLM-vision call is another strong option), and the mandatory review step so failure degrades to assisted manual entry. **Prototype with real shelf photos early in Phase 3.**
2. **IGDB rate limits & sparse TTB data.** 4 req/s cap; `game_time_to_beats` is community-sourced and missing for niche titles. Mitigations: local catalog cache, request queue, per-game manual TTB entry (`ttb_source` column).
3. **HowLongToBeat has no official API.** Scraping violates their ToS and their endpoints churn. Decision: use IGDB TTB + manual entry; revisit only if HLTB ever ships a real API.
4. **Achievements API access.** Steam Web API is official and reliable (requires the user's Steam profile be public). Xbox needs third-party OpenXBL (keyed, rate-limited); PSN is unofficial-only and breaks periodically. Commitment is Steam-only; others best-effort.
5. **Expo Go limitations.** Everything planned (camera, barcode scanning, secure token storage, image picker) works in Expo Go. Home-screen widgets or background sync would require an Expo **development build** — noted as the trigger condition for leaving Expo Go.
6. **Shared-content moderation.** Public checklist templates and shared shelves mean cross-user visibility. For a personal server this is low-stakes; the moderation model is simply admin delete.
7. **Image volume growth.** Cached covers + uploaded shelf photos accumulate; add a periodic orphan-image cleanup job (listed in `apps/api/src/jobs/`).

---

## 8. Appendix

### 8.1 V1 feature → v2 phase mapping

Nothing from v1 silently drops:

| v1 feature | v2 phase |
|---|---|
| Statuses (wishlist/backlog/playing/finished + dropped drift) | Phase 1 — all five, pinned down |
| Half-star ratings | Phase 1 |
| Platform ownership with physical/digital flags | Phase 1 (normalized table, no JSON) |
| Notes, started/finished auto-dating | Phase 1 |
| IGDB search, metadata, covers, TTB | Phase 1 |
| Text/.txt bulk import with review | Phase 1 |
| `ttbEnabled` "endless game" toggle | Phase 1 |
| Local image caching | Phase 1 |
| Custom cover upload | Phase 2 |
| Status colors, badge toggles, dashboard config | Phase 2 |
| Dashboard stats + random pick | Phase 2 |
| Screenshot OCR import + noise filtering | Phase 3 (moved server-side) |
| Collections + play-order graph + theming | Phase 4 (normalized graph tables) |
| Admin IGDB-credential settings (DB-first, env fallback) | Phase 0/1 (settings table) + Phase 6 (admin panel UI) |
| First-user-becomes-admin, registration toggle | Phase 0 |

### 8.2 External API notes

| Service | Access | Used for |
|---|---|---|
| **IGDB** | Free via Twitch developer app (client-credentials OAuth), 4 req/s | Game metadata, covers, genres, platforms, time-to-beat |
| **Steam Web API** | Free key, official | Owned games, playtime, achievements (Phase 8) |
| **OpenXBL** | Third-party, free tier, keyed | Xbox achievements (experimental) |
| **PSN** | Unofficial only | PlayStation trophies (experimental, may break) |
| **Google Cloud Vision** | Free tier ~1,000 images/month | Shelf-photo OCR |
| **IsThereAnyDeal** | Free API key | Wishlist price tracking (idea backlog) |
| **UPC lookup** (e.g., UPCitemdb) | Free tier | Barcode scanning (Phase 5) |
| **HowLongToBeat** | ❌ No official API | Not used — IGDB TTB + manual entry instead |
