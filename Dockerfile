# Multi-stage ultra-lightweight Alpine Dockerfile for minimal RAM footprint
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY src/client ./src/client

EXPOSE 3000

# Run with V8 low memory optimization limit
CMD ["node", "--max-old-space-size=64", "dist/server/index.js"]
