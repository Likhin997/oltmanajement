FROM node:22-alpine

# Install build tools for native drivers
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

COPY . .

# Build frontend production assets into /app/dist
RUN npm run build

# Persist local backup directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3004
ENV PG_HOST=localhost
ENV PG_PORT=5435
ENV PG_USER=likhin
ENV PG_DATABASE=smartolt_db

EXPOSE 3004

CMD ["npx", "tsx", "server.ts"]
