# Serves the Expo app to Expo Go phones from the server (Metro bundler).
# Build context must be the repo root:
#   docker build -f apps/mobile/Dockerfile .
#
# Runtime env (set in the compose stack):
#   EXPO_PUBLIC_API_URL            e.g. https://games.brysimp.com — inlined into
#                                  the JS bundle when Metro serves it
#   REACT_NATIVE_PACKAGER_HOSTNAME LAN IP of the *host* server — Metro advertises
#                                  this in the manifest so Expo Go fetches the
#                                  bundle from the server, not the container IP
FROM node:22-slim

RUN npm install -g pnpm@10
WORKDIR /app

# All workspace manifests must be present for the frozen-lockfile check,
# even though only @gm/mobile's dependency tree gets installed.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter @gm/mobile...
COPY apps/mobile ./apps/mobile

WORKDIR /app/apps/mobile

# CI=1 keeps the expo CLI non-interactive; --offline skips expo.dev account
# calls — everything is served over the LAN
ENV CI=1
EXPOSE 8081

CMD ["npx", "expo", "start", "--offline", "--port", "8081"]
