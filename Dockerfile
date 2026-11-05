FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node service ./service
COPY --chown=node:node reference/ai_baseline ./reference/ai_baseline
USER node
ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=10000
EXPOSE 10000
CMD ["node", "service/main.mjs"]
