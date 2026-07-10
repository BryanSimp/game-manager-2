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
- **apps/mobile**: Expo SDK 57 + Expo Router (`src/app/`), plain StyleSheet (no NativeWind).
- **packages/shared**: Zod schemas + TS types, exported as TS source (`./src/index.ts`), consumers transpile.
- **packages/api-client**: typed fetch wrapper. Web uses same-origin cookies; mobile attaches the better-auth session cookie from SecureStore via `getHeaders`.
- **Jobs**: pg-boss (rides on the same Postgres, in-process worker started in `apps/api/src/index.ts`).
- Versions pinned by better-auth 1.6 peers: **zod ^4**, **drizzle-orm ^0.45**.

## Key architecture decisions & why

- **Shared catalog vs per-user state**: `games` (one row per real-world game, keyed by
  `igdb_id`) is shared by all users; `user_games` holds per-user status/rating/notes.
  Carried over from v1 — its best idea.
- **Auth**: better-auth mounted at `/api/auth/*` (Fastify request→fetch translation in
  `server.ts`). Web = HTTP-only cookies (same origin via Vite proxy in dev, Traefik path
  routing in prod → no CORS). Mobile = `@better-auth/expo` with SecureStore. First
  registered user becomes admin (databaseHook in `auth.ts`). Registration toggled by
  `ALLOW_REGISTRATION`.
- **Statuses pinned to five**: wishlist/backlog/playing/finished/dropped (v1 had drift).
  Defined once in `packages/shared/src/constants.ts`, used for the pg enum.
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
- **jsonb only for display config** (dashboard layout, status colors) — everything else
  that v1 stored as JSON strings is normalized tables here.

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
(programmatic, also runs on Docker boot). Never use `db push`.

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

**Next: Phase 5** — mobile polish + barcode scanning (`expo-camera` UPC lookup) +
offline caching (TanStack Query persistence). Then Phase 6 (email, export, randomizer,
admin panel), 7 (completionist checklists), 8 (Steam achievements + library import).

## Deferred / known gaps

- Light theme (preference stored, no light stylesheet) — Phase 6.
- Email verification / password reset — Phase 6 (better-auth config flip + SMTP).
- Shelf photos of physical games are untested against real photos; tesseract can't read
  spines — needs `ANTHROPIC_API_KEY` (vision) for good results.
- Severely mangled OCR ("sonELAB" for BONELAB) won't auto-match — by design, the review
  UI's re-search covers it.
- Orphaned image cleanup job not yet written (images accumulate on the volume).
- `import_jobs.status='done'` cleanup/pruning not implemented.
