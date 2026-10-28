# syntax=docker/dockerfile:1

# Install production dependencies only (install scripts are disabled via .npmrc).
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# Distroless runtime: no shell or package manager, runs as an unprivileged user.
FROM gcr.io/distroless/nodejs22-debian13:nonroot
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
EXPOSE 8080
CMD ["src/server.js"]
