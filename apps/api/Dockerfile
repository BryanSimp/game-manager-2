# Build context must be the repo root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-slim

# tesseract for the Phase 3 OCR pipeline; openssl for TLS
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr openssl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

# All workspace manifests must be present for the frozen-lockfile check,
# even though only @gm/api's dependency tree gets installed.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter @gm/api...
COPY apps/api ./apps/api

WORKDIR /app/apps/api

ENV NODE_ENV=production
EXPOSE 3001

# Apply migrations, then start the server
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
