FROM node:20-slim AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY api ./api

EXPOSE 4000

CMD ["sh", "-c", "npx tsx src/init-db.ts && npx tsx api/server.ts"]
