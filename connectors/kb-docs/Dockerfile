# kb-docs MCP connector — read-only knowledge base.
# Runs on the internal `connectors` network behind ContextForge; never exposed
# publicly. No external egress (serves a local document store).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY data ./data
# stdio MCP server — ContextForge spawns/attaches it.
ENTRYPOINT ["node", "dist/server.js"]
