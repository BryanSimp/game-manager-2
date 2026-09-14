# Game Manager 2

Self-hosted game library manager — a web app and an Expo mobile app sharing one API and one
account system. Track what you own across Steam, every console you have and the shelf of
cartridges, plan a backlog with honest time-to-beat estimates, and follow story progress mission
by mission.

The hosted instance runs at [gamesmanager.app](https://gamesmanager.app). The source is public
and you are welcome to run your own — see [Self-hosting](#self-hosting) below. See
[PLAN.md](PLAN.md) for the full feature list, architecture and roadmap.

## Layout

```
apps/api      Fastify + Drizzle + PostgreSQL + better-auth (the only backend)
apps/web      Vite + React SPA (served by nginx in prod)
apps/mobile   Expo app (Expo Go for development)
packages/     shared Zod schemas, typed API client, shared tsconfig
deploy/       docker-compose files: dev (postgres only), self-host, and prod
```

## Self-hosting

Everything runs in three containers: the API, nginx serving the built web app, and PostgreSQL.
Your library never leaves your own database, and no feature is held back — the hosted instance
runs this same code.

**You need:** a machine with Docker and the Compose plugin, and about 2 GB of free disk for the
images. No registry account and no reverse proxy are required to get started.

### 1. Clone and configure

```bash
git clone https://github.com/BryanSimp/game-manager-2.git
cd game-manager-2
cp .env.example .env
```

Edit `.env` and set at least these two:

| Variable | What to set it to |
|---|---|
| `BETTER_AUTH_SECRET` | a real secret — `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | any password you like; it is only used between the containers |

Two more matter as soon as the app is not on `localhost`:

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | The URL you type into a browser, port included. Sign-in and password-reset links are built from it, so it has to match exactly. |
| `WEB_PORT` | `8080` | Host port nginx binds to. |

### 2. Bring the stack up

```bash
docker compose -f deploy/docker-compose.selfhost.yml up -d --build
```

The first build takes a few minutes. The API applies database migrations and seeds the platform
list on every boot, so there is no separate setup step. Watch it start with
`docker compose -f deploy/docker-compose.selfhost.yml logs -f api`.

### 3. Create your account

Open <http://localhost:8080> and register. **The first account to register becomes the admin** —
do this before anyone else gets to the URL. Afterwards, set `ALLOW_REGISTRATION=false` in `.env`
and `up -d` again if you want to close sign-ups.

### 4. Add the API keys you want

These are all optional, and all of them can be pasted into **Settings** in the app as an admin
rather than put in `.env` — database settings take precedence over the environment either way.

| Key | Get it from | Without it |
|---|---|---|
| IGDB (`IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`) | a [Twitch developer app](https://dev.twitch.tv/console/apps) | No game search, covers or metadata. This is the one worth setting up. |
| `STEAM_API_KEY` | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) | No Steam library import or achievement sync. |
| `STEAMGRIDDB_API_KEY` | [steamgriddb.com](https://www.steamgriddb.com/profile/preferences/api) | Cover browsing hides itself; uploading your own art still works. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | OCR import falls back to local tesseract — fine for launcher screenshots, poor on photos of physical shelves. |
| `RESEND_API_KEY` + `EMAIL_FROM` | [resend.com](https://resend.com) | Password reset can't send mail. Resend's default `onboarding@resend.dev` sender only delivers to the Resend account owner, so a verified domain is needed for other people's resets. |

### 5. Putting it behind a domain

The self-host compose deliberately has no TLS and no reverse proxy. To put it on a domain, point
your existing proxy (Traefik, Caddy, nginx, Cloudflare Tunnel…) at the `web` container's port and
set `APP_URL` to the public `https://` URL. Keep the API on the **same origin** as the web app,
under the `/api` path — sessions are HTTP-only cookies, so a separate API origin means they are
never sent. `deploy/nginx.selfhost.conf` shows the routing the stack expects;
[deploy/README.md](deploy/README.md) documents the Traefik/Portainer/Watchtower setup the hosted
instance uses, if you want the automatic-deploy version.

### Updating

```bash
git pull
docker compose -f deploy/docker-compose.selfhost.yml up -d --build
```

Migrations run on boot. Your data lives in the `gm2-selfhost-pgdata` volume (and uploaded images
in `gm2-selfhost-images`), so rebuilds don't touch it — back those two volumes up.

### The mobile app

The Expo app is not part of the self-host stack. Run it with `pnpm dev:mobile` and set
`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your server's URL; the phone needs to be able to
reach it. The production compose file also shows a `mobile` service that hosts the Metro bundler
for Expo Go over a LAN.

## Development

Prereqs: Node 20+, pnpm (`npm i -g pnpm`), Docker.

```bash
pnpm install
cp .env.example .env                                # then edit values
docker compose -f deploy/docker-compose.yml up -d   # starts Postgres only
pnpm db:migrate                                     # apply migrations
pnpm db:seed                                        # seed the platform list
pnpm dev:api                                        # API on :3001
pnpm dev:web                                        # web on :5173 (proxies /api → :3001)
pnpm dev:mobile                                     # Expo Go (set EXPO_PUBLIC_API_URL to your LAN IP)
```

First registered account becomes the admin. Other useful scripts:

```bash
pnpm typecheck                            # every package
pnpm --filter @gm/api db:generate         # new SQL migration after a schema change
pnpm db:seed-demo                         # (re)build the /demo showcase account
```

Migrations are plain SQL in `apps/api/drizzle/`, applied programmatically by `src/db/migrate.ts`.
Don't use `drizzle-kit push`.

## Production (the gamesmanager.app deployment)

```bash
docker compose -f deploy/docker-compose.prod.yml up -d
```

That stack pulls prebuilt images from GHCR and expects Traefik plus Watchtower — it is the
hosted instance's setup, not a general-purpose one. See [deploy/README.md](deploy/README.md).
For your own server, use the self-hosting stack above.

## Licence and attribution

Game metadata and cover art come from [IGDB](https://www.igdb.com), alternate artwork from
[SteamGridDB](https://www.steamgriddb.com), and library/achievement data from the official
[Steam Web API](https://steamcommunity.com/dev). Game Manager is not affiliated with,
sponsored by or endorsed by Valve, Twitch Interactive (IGDB) or SteamGridDB; all game titles,
artwork and trademarks belong to their respective owners. If you run a public instance, keep the
attribution in the site footer — those providers' terms ask for it.
