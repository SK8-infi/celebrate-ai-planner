# syntax=docker/dockerfile:1

# Base images are pinned by digest so a re-tagged upstream image cannot change the build;
# Dependabot proposes digest updates. Install scripts are disabled via .npmrc.
FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# Distroless runtime: no shell or package manager, runs as an unprivileged user.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:1b90ca047c3a1046ad3527998c747c25b6a88dde91ba8c71b98669d5813aaa21
WORKDIR /app
USER nonroot
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
EXPOSE 8080
CMD ["src/server.js"]
