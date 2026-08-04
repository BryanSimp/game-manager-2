# Deploying Game Manager 2 (Ubuntu + Portainer + Traefik)

The flow: **push to main → GitHub Actions builds `ghcr.io/bryansimp/gm2-api`,
`gm2-web`, and `gm2-mobile` → Watchtower on the server pulls the new images
within 5 minutes.**
After the first-time setup below, deploys are fully automatic.

## One-time server prep

1. **GHCR credentials** (the packages are private). Create a GitHub PAT
   (classic) with only the `read:packages` scope
   (github.com → Settings → Developer settings → Personal access tokens), then
   on the server:

   ```bash
   docker login ghcr.io -u BryanSimp
   # paste the PAT as the password
   ```

   This stores credentials in `/root/.docker/config.json` (run as root/sudo),
   which both Docker pulls and the Watchtower container use.

   **Snap-docker gotcha (this server):** Docker is snap-installed, so
   `sudo docker login` writes to `/root/snap/docker/<rev>/.docker/config.json`
   instead — but the stack mounts `/root/.docker/config.json` into Watchtower.
   Copy it into place *before* (re)deploying the stack:

   ```bash
   sudo mkdir -p /root/.docker
   sudo cp /root/snap/docker/*/.docker/config.json /root/.docker/config.json
   ```

   Order matters: if the file is missing when a container with that mount
   starts, Docker silently creates the path as an **empty directory** and
   Watchtower fails every pull with `/config.json: is a directory`. If that
   happens: remove the watchtower container, `sudo rm -rf` the directory,
   copy the file, then redeploy. The copy is a static snapshot — after
   rotating the PAT, redo both the login and the copy.

2. **Portainer registry** (so Portainer's own image pulls work too):
   Portainer → Registries → Add registry → Custom →
   URL `ghcr.io`, username `BryanSimp`, password = the same PAT.

3. The external `proxy` network already exists from the v1 setup. The Traefik
   labels assume the `websecure` entrypoint and `cloudflare` cert resolver —
   same conventions as v1's compose file.

## Deploy the stack

Portainer → Stacks → Add stack → name `game-manager-2` → paste
`deploy/docker-compose.prod.yml` (or point Portainer's Git option at the repo,
path `deploy/docker-compose.prod.yml`). Set these environment variables in the
stack editor:

| Var | Value |
|---|---|
| `GM_HOST` | `gamesmanager.app` (already the default) |
| `GM_OLD_HOST` | `games.brysimp.com` — 301s to `GM_HOST`; drop it once nothing points there |
| `POSTGRES_USER` | e.g. `gm` |
| `POSTGRES_PASSWORD` | generate one |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` — never reuse v1's |
| `ALLOW_REGISTRATION` | `true` until accounts exist, then redeploy with `false` |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | optional — can be pasted into web Settings instead |
| `STEAM_API_KEY` | optional — same, Settings UI works |
| `ANTHROPIC_API_KEY` | optional — enables Claude-vision OCR for shelf photos |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional — password-reset email; DB Settings win over both. No key = the reset flow can't send |
| `SERVER_LAN_IP` | the server's LAN IP (e.g. `192.168.68.60`) — advertised by the Expo bundler so phones can reach it |
| `TZ` | `America/Chicago` |

The API container applies DB migrations automatically on boot.

## Moving to gamesmanager.app

Both zones sit on the same Cloudflare account, and `games.brysimp.com` is
**DNS-only** (grey cloud) straight to the house — Traefik terminates TLS itself
and gets certs over the `cloudflare` DNS-01 resolver, never port 80. So the move
is three things: a DNS record, a token that can see the new zone, and `GM_HOST`.

1. **Cloudflare → gamesmanager.app → DNS**: add an `A` record, name `@`, value =
   whatever `brysimp.com`'s apex A record holds (`96.35.10.148` today),
   **proxy status DNS only**. If that IP is kept current by a dynamic-DNS client
   pointed at `brysimp.com`, use a `CNAME` `@` → `brysimp.com` instead —
   Cloudflare flattens an apex CNAME, so the new domain follows the old one's
   IP without a second DDNS entry. Add `www` → `gamesmanager.app` (CNAME, DNS
   only) if you want the redirect router below to catch it.
2. **The DNS-01 token must cover the new zone.** Wherever Traefik reads
   `CF_DNS_API_TOKEN`, that token was almost certainly scoped to *brysimp.com
   only*; ACME then fails for gamesmanager.app with a zone-lookup error and no
   cert is ever issued. Cloudflare → My Profile → API Tokens → edit the token →
   Zone Resources → add `gamesmanager.app` (or *All zones from an account*).
   Editing in place takes effect immediately; a brand-new token means updating
   Traefik's env and restarting it.
3. Redeploy this stack with `GM_HOST=gamesmanager.app`. Traefik requests the new
   cert on first request — allow a minute, and watch `docker logs traefik` if it
   doesn't come.

Notes:

- **Everyone signs in again.** `BETTER_AUTH_URL` moving means the existing
  session cookies were issued for a host that no longer serves the app.
  Accounts, libraries and images are in Postgres and the `gm2-images` volume,
  untouched.
- **The phone needs a nudge**: restart the `mobile` container so Metro re-inlines
  `EXPO_PUBLIC_API_URL`, then fully reload the app in Expo Go and sign in again
  (the old session cookie lives in SecureStore).
- **`.app` is HSTS-preloaded** — browsers refuse plain http to it, always. That
  is fine here (DNS-01 needs no port 80), but any link you type must be `https://`.
- The `gm2-legacy` router in the compose file 301s `games.brysimp.com` and
  `www.gamesmanager.app` to the apex. Leave `games.brysimp.com`'s DNS record in
  place while that router exists — it still has to resolve to the server for the
  redirect to happen, and Traefik still gets a cert for it.
- Only if you later turn the orange cloud **on**: set SSL/TLS mode to
  **Full (strict)** (Flexible would loop against Traefik's https redirect), and
  know that Cloudflare proxies standard ports only — the Expo bundler on 8081
  stays LAN-only regardless, which it already is.

## Cutover from v1 (historical — same URL)

Both stacks claim ``Host(`games.brysimp.com`)``, so don't run them side by side:

1. Back up v1 first (its SQLite file lives in the `gamedata` volume):
   ```bash
   docker run --rm -v gamedata:/data -v "$PWD":/backup alpine \
     cp /data/app.db /backup/gm1-app-$(date +%F).db
   ```
2. Stop the v1 stack in Portainer (stop, don't delete — keep the volume until
   you're happy with v2).
3. Deploy the `game-manager-2` stack. Traefik picks up the new labels within
   seconds; the URL now serves v2.
4. Open the site, register — **the first account becomes
   admin** — then paste IGDB credentials in Settings and set
   `ALLOW_REGISTRATION=false` once the household is on board.

v1's data stays untouched in the `gamedata` volume. v2 starts empty (fresh
schema, different data model); rebuild the library via IGDB search, Steam
import, or the OCR importer. A one-off v1→v2 data migration script is possible
later if wanted — the volume backup keeps that option open.

## Mobile app (Expo Go)

The `mobile` service runs the Expo/Metro bundler in a container and serves the
app to phones over the LAN — same API, same database, same accounts as the web
app.

- On the phone (same wifi as the server): **Expo Go → "Enter URL manually" →
  `exp://<SERVER_LAN_IP>:8081`**. Sign in with the same account as the website.
- The first load after a container (re)start compiles the bundle on the server —
  expect a minute or two; subsequent loads are fast until the next restart.
- The phone's Expo Go must match the project's **pinned SDK 54** — don't upgrade
  the `expo` package without upgrading Expo Go, or vice versa.
- Port 8081 is plain http on the LAN only (not routed through Traefik); the app
  itself talks to the API over https like the web app does.
- Watchtower auto-updates this container too, so merged mobile changes reach the
  phone on the next app reload after the image updates.

## How auto-update works

- `.github/workflows/docker.yml` builds+pushes both images on every push to
  `main` (≈3–5 min).
- The `watchtower` service in the stack polls GHCR every 5 minutes for
  containers labeled `com.centurylinklabs.watchtower.enable=true` (only
  gm2-api, gm2-web, and gm2-mobile — it won't touch other containers on the
  server), pulls new `:latest` images, restarts the containers, and prunes old
  images.
- Net effect: a push lands on gamesmanager.app in under ~10 minutes with no
  manual step. To skip auto-updates for a while, stop the watchtower container;
  manual update = Portainer → stack → "Pull and redeploy".
- The web app shows the deployed build's short commit sha bottom-right once
  signed in — compare it against the latest commit on `main` to confirm a
  deploy actually landed.
- If updates stop, check `docker logs --since 1h watchtower`. Known failure:
  `client version 1.25 is too old` on every poll — watchtower's docker client
  botches version negotiation against modern daemons; the stack pins
  `DOCKER_API_VERSION: "1.44"` to prevent it. If the daemon ever rejects that
  pin after an upgrade ("client version newer than server"), adjust it to a
  version the daemon lists under `docker version`.

## Backups (v2)

```bash
docker exec $(docker ps -qf name=postgres -f name=game-manager-2) \
  pg_dump -U "$POSTGRES_USER" gamemanager > gm2-backup-$(date +%F).sql
docker run --rm -v gm2-images:/data -v "$PWD":/backup alpine \
  tar czf /backup/gm2-images-$(date +%F).tar.gz -C /data .
```
