FROM node:22-bookworm-slim

WORKDIR /app

# Runtime secrets (TELEGRAM_BOT_TOKEN, DATABASE_URL, TONCENTER_API_KEY, …)
# must be injected by the host. Never COPY a .env file into the image.

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json schema.sql ./
COPY src ./src

ENV NODE_ENV=production

USER node
CMD ["npm", "start"]
