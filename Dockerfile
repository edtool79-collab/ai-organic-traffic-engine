FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CRAWLEE_AVAILABLE_MEMORY_RATIO=0.85

COPY package*.json ./
COPY dashboard/package*.json ./dashboard/

RUN npm ci --omit=dev && \
    cd dashboard && npm ci --omit=dev

COPY src ./src
COPY tools ./tools
COPY dashboard ./dashboard
COPY .env.example ./

RUN mkdir -p /app/data /app/reports /app/runs /app/session-profiles && \
    chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 4310

CMD ["node", "dashboard/server.js"]
