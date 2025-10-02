FROM node:20-alpine

# Install runtime deps
RUN apk add --no-cache bash postgresql-client

WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy application sources
COPY index.ts table-def.sql ./

# Build at image build time so runtime doesn't depend on CWD/npm
RUN npx tsc

# Add an entrypoint that ensures we run from /app regardless of external --workdir
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]


