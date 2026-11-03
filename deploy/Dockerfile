# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN npm install --global pnpm@11.2.2
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build && pnpm guide:build
RUN pnpm --filter @remo/sync deploy --prod --legacy /runtime

FROM node:22-bookworm-slim AS sync
ENV NODE_ENV=production PORT=1234 REMO_DATA_DIR=/var/lib/remo
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
RUN mkdir -p /var/lib/remo && chown node:node /var/lib/remo
USER node
EXPOSE 1234
CMD ["node", "server.mjs"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.container.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /srv/app
COPY --from=build /src/docs-site /srv/docs
EXPOSE 8080 8081
