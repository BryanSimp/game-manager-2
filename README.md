# Game Manager 2

Self-hosted game library manager — web app + Expo mobile app sharing one API and one account system. See [PLAN.md](PLAN.md) for the full feature list, architecture, and roadmap.

## Layout

```
apps/api      Fastify + Drizzle + PostgreSQL + better-auth (the only backend)
apps/web      Vite + React SPA (served by nginx in prod)
apps/mobile   Expo app (Expo Go for development)
packages/     shared Zod schemas, typed API client, shared tsconfig
deploy/       docker-compose for dev (postgres only) and prod (full stack)
```

## Development

Prereqs: Node 20+, pnpm (`npm i -g pnpm`), Docker.

```bash
pnpm install
cp .env.example .env                      # then edit values
docker compose -f deploy/docker-compose.yml up -d   # starts Postgres
pnpm db:migrate                           # apply migrations
pnpm db:seed                              # seed platforms + admin user
pnpm dev:api                              # API on :3001
pnpm dev:web                              # web on :5173
pnpm dev:mobile                           # Expo Go (set EXPO_PUBLIC_API_URL to your LAN IP)
```

First registered account becomes the admin.

## Production (on the Linux server)

```bash
git clone <this repo> && cd game-manager-2
cp .env.example .env                      # set real secrets + domain
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

The prod compose builds the `api` and `web` images locally and runs Postgres alongside, behind your existing Traefik proxy. Images can also be pulled from a registry instead of building — see [deploy/README.md](deploy/README.md).
