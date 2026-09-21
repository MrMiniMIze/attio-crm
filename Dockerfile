# Build: install everything, typecheck, bundle to a single file.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build

# Runtime: production dependencies plus the bundle, nothing else. A small
# image is also a short cold start, which matters here — Slack allows three
# seconds to answer and a cold container spends some of it.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
# Cloud Run sets PORT and requires the process to listen on 0.0.0.0.
CMD ["node", "dist/server.js"]
