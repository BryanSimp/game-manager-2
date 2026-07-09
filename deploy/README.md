# Deploying Game Manager 2

## Option A — build on the server (simplest)

```bash
git clone <repo url> game-manager-2 && cd game-manager-2
cp .env.example .env
# edit .env: set GM_HOST, POSTGRES_PASSWORD, BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Updates:

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Requires the external `proxy` Docker network used by your existing Traefik setup
(`docker network create proxy` if it doesn't exist). Traefik labels assume the
`websecure` entrypoint and `cloudflare` cert resolver from the v1 setup — adjust
if yours differ.

## Option B — pull prebuilt images from a registry

The GitHub Actions workflow in `.github/workflows/docker.yml` builds and pushes
`gm2-api` and `gm2-web` images on every push to `main`.

- **GitHub Container Registry (default, zero setup):** images publish to
  `ghcr.io/<your-github-user>/gm2-api:latest` and `gm2-web:latest` automatically.
- **Docker Hub (optional):** create repo secrets `DOCKERHUB_USERNAME` and
  `DOCKERHUB_TOKEN` in the GitHub repo settings, and the workflow also pushes
  `docker.io/<user>/gm2-api` and `gm2-web`.

On the server, replace the `build:` blocks in `docker-compose.prod.yml` with:

```yaml
  api:
    image: ghcr.io/<your-github-user>/gm2-api:latest
  web:
    image: ghcr.io/<your-github-user>/gm2-web:latest
```

Updates then become:

```bash
docker compose -f deploy/docker-compose.prod.yml pull
docker compose -f deploy/docker-compose.prod.yml up -d
```

## Env vars (root .env)

| Var | Purpose |
|---|---|
| `GM_HOST` | Public hostname, e.g. `gm.example.com` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials |
| `BETTER_AUTH_SECRET` | Session signing secret — generate fresh, never commit |
| `ALLOW_REGISTRATION` | `true` until your household has accounts, then `false` |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch dev app for IGDB (Phase 1) |
| `TZ` | Server timezone |

## Backups

```bash
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" gamemanager > backup-$(date +%F).sql
docker run --rm -v deploy_images:/data -v "$PWD":/backup alpine \
  tar czf /backup/images-$(date +%F).tar.gz -C /data .
```
