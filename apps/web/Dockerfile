# Build context must be the repo root:
#   docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build

RUN npm install -g pnpm@10
WORKDIR /app

# All workspace manifests must be present for the frozen-lockfile check,
# even though only @gm/web's dependency tree gets installed.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter @gm/web...
COPY apps/web ./apps/web
# short commit sha from CI; surfaces as the version badge in the app shell
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN pnpm --filter @gm/web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
