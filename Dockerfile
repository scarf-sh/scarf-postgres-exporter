FROM node:20-alpine

# Install runtime deps
RUN apk add --no-cache bash postgresql-client

WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy application sources
COPY index.ts table-def.sql ./

# Default command compiles TS and runs the app
CMD ["bash", "-lc", "npm run buildAndRun"]



