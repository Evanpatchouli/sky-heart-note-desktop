FROM node:24-alpine AS dependencies
WORKDIR /app
RUN npm install -g pnpm@10.30.0
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY common/package.json ./common/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY common ./common/
COPY server ./server/
RUN pnpm --dir common build && pnpm --dir server build

FROM dependencies AS production-dependencies
ENV CI=true
RUN pnpm install --prod --offline --frozen-lockfile --store-dir=/pnpm/store

FROM node:24-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=production-dependencies /app/server/node_modules ./node_modules
COPY --from=build /app/common/package.json /app/common/package.json
COPY --from=build /app/common/dist /app/common/dist
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/dist ./dist
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA}
EXPOSE 8793
CMD ["node", "dist/src/main.js"]
