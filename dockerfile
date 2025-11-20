# ========= STAGE 1: Builder =========
FROM node:20-alpine AS builder

ARG DATABASE_URL

# Install pnpm globally
RUN npm install -g pnpm@9

WORKDIR /app

# 1. Copy only package files first (best caching)
COPY package.json pnpm-lock.yaml ./

# 2. Install dependencies FIRST → THIS IS THE FIX
# By default pnpm in Docker does --prod! Force it to install everything:
RUN pnpm install --frozen-lockfile --ignore-scripts=false

# 3. NOW copy the rest of the source code
COPY . .

# 4. Generate Prisma client (now works because DATABASE_URL exists)
RUN npx prisma generate
RUN npx prisma migrate deploy

# ========= STAGE 2: Runtime =========
FROM node:20-alpine AS runtime

WORKDIR /app

# Install only runtime globals
RUN npm install -g tsx prisma @prisma/client

# Copy everything from builder (including @hashgraph/sdk!)
COPY --from=builder /app /app

# Non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S -u 1001 appuser
USER appuser

EXPOSE 8080

CMD ["tsx", "src/app.ts"]