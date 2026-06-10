# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .

# VITE_ vars are baked into the client bundle at build time
ARG VITE_FIREBASE_PROJECT_ID=wave-hris-fb
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID

# Build with Nitro node-server preset (outputs dist/server/index.mjs)
RUN NITRO_PRESET=node-server npm run build

# ── Stage 2: Run ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Copy the full dist/ directory — server references client assets via relative paths
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT=8080; Nitro reads process.env.PORT automatically
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server/index.mjs"]
