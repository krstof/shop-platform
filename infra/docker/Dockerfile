# =============================================================================
# Container-Abbilder der eigenen Dienste (Architektur 7.1, Sicherheit 5.11 und 5.16).
#   docker build -f infra/docker/Dockerfile --target api     .
#   docker build -f infra/docker/Dockerfile --target migrate .
#   docker build -f infra/docker/Dockerfile --target worker  .
# `pnpm dev` baut alle drei (tools/dev.mjs).
#
# Aufbau in zwei Stufen:
# 1. build: installiert mit der Lockdatei, übersetzt TypeScript und legt mit `pnpm deploy`
#    je Dienst einen Ordner an, der nur die Laufzeit-Abhängigkeiten enthält.
# 2. api / migrate / worker: schlankes Node-Abbild, ohne npm, ohne Quellcode und ohne Prüfwerkzeuge.
#    Die Dateien gehören root und sind für den Dienst nur lesbar; er läuft als `node` (UID 1000).
#
# Basisabbild mit fester Version UND fester Prüfsumme. Dependabot schlägt Updates vor.
# =============================================================================
ARG NODE_IMAGE=node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

FROM ${NODE_IMAGE} AS build
ENV CI=true \
    PNPM_HOME=/pnpm \
    ASTRO_TELEMETRY_DISABLED=1
ENV PATH=/pnpm:$PATH
WORKDIR /src
# Optional: zusätzliche Zertifizierungsstelle für Umgebungen mit eigenem Proxy (z. B. Cloud-Sitzungen).
# Wird nur beim Bauen eingebunden und landet nie im Abbild.
RUN --mount=type=secret,id=extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm install -g --no-fund --no-audit pnpm@12.15.0
COPY . .
# Nur die drei Dienste und ihre Bausteine, nicht die Prüfwerkzeuge des Repositorys.
RUN --mount=type=secret,id=extra_ca \
    --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@shop/api..." --filter "@shop/migrate..." --filter "@shop/worker..." && \
    pnpm --filter "@shop/api..." --filter "@shop/migrate..." --filter "@shop/worker..." run build && \
    pnpm --filter @shop/api deploy --prod --offline /out/api && \
    pnpm --filter @shop/migrate deploy --prod --offline /out/migrate && \
    pnpm --filter @shop/worker deploy --prod --offline /out/worker
# Migrationen und Rollen für den Dienst migrate (Aufbau wie im Repository, siehe findMigrationDirs).
RUN mkdir -p /out/schema/db /out/schema/packages/kernel /out/schema/modules && \
    cp db/roles.sql /out/schema/db/ && \
    cp -r packages/kernel/migrations /out/schema/packages/kernel/ && \
    for d in modules/*/migrations; do m="${d%/migrations}"; mkdir -p "/out/schema/$m"; cp -r "$d" "/out/schema/$m/"; done

# Gemeinsame Laufzeit: npm, npx und corepack werden entfernt, der Dienst braucht sie nicht.
FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=root:root /out/api /app
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM runtime AS migrate
COPY --from=build --chown=root:root /out/migrate /app
COPY --from=build --chown=root:root /out/schema /schema
ENV SHOP_MIGRATIONS_ROOT=/schema
CMD ["node", "dist/main.js"]

# Hintergrunddienst (E5): Relay, Zustellung, Aufräumen. Keine Netzschnittstelle nach außen; das
# Lebenszeichen /livez lauscht nur auf 127.0.0.1 im Container (Gesundheitscheck).
FROM runtime AS worker
COPY --from=build --chown=root:root /out/worker /app
CMD ["node", "dist/main.js"]
