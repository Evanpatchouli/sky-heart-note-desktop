FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.30.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY common/package.json ./common/
COPY admin/package.json ./admin/
COPY employee/package.json ./employee/
COPY client/package.json ./client/
COPY site/package.json ./site/
RUN pnpm install --frozen-lockfile

COPY common ./common/
RUN pnpm --dir common build

ARG WEB_APP
ARG VITE_APP_API_BASE_URL=/api
COPY ${WEB_APP}/ ./${WEB_APP}/
RUN pnpm --dir "${WEB_APP}" build

FROM nginx:stable-alpine
ARG WEB_APP
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=${GIT_SHA}
COPY deploy/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/${WEB_APP}/dist/ /usr/share/nginx/html/
EXPOSE 80
