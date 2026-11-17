FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CRAWLEE_AVAILABLE_MEMORY_RATIO=0.85

COPY package*.json ./
COPY dashboard/package*.json ./dashboard/

RUN npm install --omit=dev && \
    cd dashboard && npm install --omit=dev

COPY . .

EXPOSE 4310

CMD ["node", "dashboard/server.js"]
