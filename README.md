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

## Connect Claude

The API serves an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`, so Claude can
answer questions about your library — "what should I play next?", "how far through Hollow Knight
am I?", "how long is the rest of my Zelda marathon?" — and, if you let it, organise it: "tag all
my co-op games", "make a collection of the Zelda games in release order", "make a checklist of
Hollow Knight's bosses", "I just beat the Mantis Lords, tick them off", "link the DLC to its base
games". Each person connects with their own credentials and only ever sees or changes their
own library.

Reading is always on. **Changes are opt-in, per key or per connection**: a key only writes if you
ticked **Allow changes** when you made it, and claude.ai only writes if you ticked **Allow
changes** on the consent screen. Keys and connections made before this option existed stay
read-only.

### Claude Code

In the web app, open **Preferences → API keys**, name a key after the device it's for, tick
**Allow changes** if you want Claude to be able to organise your library (leave it off for a key
that only reads), and create it. The key is shown once; the card gives you the full command, which
looks like:

```bash
claude mcp add --transport http gamesmanager https://<your-host>/api/mcp --header "Authorization: Bearer <key>"
```

Add `--scope user` to have it in every project rather than just the current folder, then check it
with `claude mcp list`. Make one key per device and revoke the ones you stop using — a revoked key
stops working on its next request. A key only works at `/api/mcp`: it isn't a session, so it can't
be used against the rest of the API.

A key can't be switched from read-only to "Allow changes" later — make a new one. To swap the key
Claude Code uses:

```bash
claude mcp remove gamesmanager
```

then run the `claude mcp add …` command the card gave you for the new key (with the same
`--scope` you used before), and revoke the old key on the API keys card.

### What Claude can do

Reading, with any key or connection: `list_library` (filter by category, platform, tag or title),
`get_game` (notes, mission progress, checklists and linked DLC/sequels/remakes), `get_dashboard`,
`list_collections`, `get_collection` (games in play order), `list_categories`,
`get_backlog_candidates` (Backlog, Shelved and Wishlist, shortest remaining first), `get_checklist`
(one of a game's checklists, item by item and numbered) and `get_achievements` (a game's Steam
achievements and which you've unlocked, once Steam is linked and synced).

Changing, only with **Allow changes** on:

- `create_tag` — a tag, with an optional colour and group ("Franchise", "Mode"). A name you
  already have returns that tag unchanged.
- `tag_games` / `untag_games` — add one tag to (or take it off) up to 100 games. Adding keeps
  each game's other tags; untagging removes the tag from those games, never the tag itself.
- `create_collection` — a collection, optionally started with games in order. Always private,
  whatever your publish preference says; a name you already have returns that collection.
- `add_games_to_collection` — append up to 100 games to one of your collections, in order.
- `create_checklist` — a progress checklist for a game in your library, up to 500 items, optionally
  grouped into chapters. A `main_story` list (one per game) is what the Progress tab divides the
  time to beat across; anything else is an extra list. Always private and nothing ticked. A title
  the game already has a list under adds to that list, skipping items it already has.
- `tick_checklist_items` — tick items off one of your checklists (or untick them), by exact text
  or by number, and optionally every item named exactly like a Steam achievement you've unlocked.
  A sequential main story list fills in the items before, as the Progress tab does. Text that
  matches no item, or several, comes back with item numbers rather than being guessed. Claude is
  told to tick only what you say you've done or your achievements show.
- `link_games` — DLC, prequel/sequel or remake/remaster links, with the same rules as the Linked
  tab (no self-links, one link per pair).
- `set_time_to_beat` — your own main / main + extras / completionist hours for a game. Yours
  replace IGDB's figure for you (as they do when you type them on the game's page), and they feed
  the community average, so Claude is told to set them only when you give a figure or a reliable
  source does. Clearing them goes back to IGDB's.

Games are named by id or exact title. Collections and links can include games you don't own, as
in the web app: a title that isn't in your library is looked up in the shared catalog, then on
IGDB.

What it can't do, with any key: delete anything; rename or delete tags, collections or
checklists; edit, reorder or remove checklist items; change a game's category, rating, notes,
platforms or dates; publish a collection or checklist; or touch your account or settings. One request carries at most one change, and every change is logged (tool name and
counts, never titles) like the web app's own writes.

### claude.ai (custom connector)

claude.ai connects over OAuth instead of a key. In claude.ai, open **Settings → Connectors → Add
custom connector**, give it a name and the URL `https://<your-host>/api/mcp`, then **Connect**.
You land on your instance's normal sign-in (two-factor included, if you've turned it on), then a
consent screen naming the app and what it can read. If the app asks to make changes, that's a
separate **Allow changes** line, unticked — tick it to let Claude use the write tools above, or
leave it and the connection only reads. Allow, and you're sent back to claude.ai. Connected apps
are listed under **Preferences → API keys** (with whether each can make changes), where
**Disconnect** cuts one off on its next request.

A connector added before changes existed stays read-only, even after a refresh: its registration
only covers reading. To let it make changes, remove the connector in claude.ai (**Settings →
Connectors**), disconnect it under **Preferences → API keys → Connected apps**, then add it again
with the same URL and tick **Allow changes** when you're asked.

Under the hood: claude.ai reads `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`, registers itself (OAuth dynamic client registration),
and runs the authorization-code flow with PKCE. Three things have to be true for that to work:

- **`BETTER_AUTH_URL` is the public URL**, exactly — `https://<your-host>`, no trailing slash.
  The issuer, the token audience and every URL in the discovery documents are built from it.
- **`/.well-known/oauth-*` reaches the API.** Those two documents live at the root, not under
  `/api`. The self-host nginx config and the production Traefik labels already route them; if you
  run your own proxy, send that prefix to the API container too. Check it with
  `curl https://<your-host>/.well-known/oauth-protected-resource` — JSON, not the web app's HTML.
- **The redirect URI is allowed.** Registration only accepts claude.ai's callback,
  `https://claude.ai/api/mcp/auth_callback` (and `https://claude.com/api/mcp/auth_callback`), plus
  loopback addresses for local clients like Claude Code. To connect another MCP client, add its
  callback to `OAUTH_REDIRECT_URIS` (comma-separated). Anyone can register a client, so this list
  is what stops a stranger's app from receiving your sign-ins.

If Cloudflare sits in front, make sure Bot Fight Mode or a challenge rule isn't intercepting
`/api/mcp` and `/.well-known/oauth-*` — claude.ai calls them server-to-server and can't solve a
challenge.

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
pnpm --filter @gm/api check:mcp           # MCP endpoint end to end (needs a migrated database)
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
