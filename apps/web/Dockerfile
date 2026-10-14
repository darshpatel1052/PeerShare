FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/tracker/package.json services/tracker/package.json
RUN npm ci --include=optional \
    && node -e "require('lightningcss'); require('@tailwindcss/oxide');"
COPY apps/web/ apps/web/
COPY packages/player/ packages/player/
COPY packages/contracts/src/ packages/contracts/src/
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run web-build

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules/ws/ node_modules/ws/
COPY --from=build --chown=node:node /app/apps/web/out/ apps/web/out/
COPY --chown=node:node scripts/ scripts/
COPY --chown=node:node services/tracker/ services/tracker/
USER node
EXPOSE 3000 3001 8000
CMD ["node", "scripts/demo.mjs"]
