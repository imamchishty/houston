# Build: compile TypeScript, then drop dev dependencies
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY scripts ./scripts
COPY src ./src
# Build stamp for the footer: pass --build-arg BUILD_NUMBER=... GIT_SHA=... BUILD_TIME=... (CI and azure.sh do)
ARG BUILD_NUMBER GIT_SHA BUILD_TIME
RUN BUILD_NUMBER=$BUILD_NUMBER GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME npm run build && npm prune --omit=dev

# Run: compiled JS and production dependencies only, as the unprivileged node user
FROM node:22-alpine
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production PORT=4000 HOUSTON_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-info.json ./
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
