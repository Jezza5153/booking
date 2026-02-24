FROM node:20-alpine

WORKDIR /app

# Copy server files
COPY server/package*.json ./
RUN npm install --production

COPY server/ ./

# FIX #33: Run as non-root user for defense-in-depth
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Cloud Run / Railway expects port 8080 by default
ENV PORT=8080
EXPOSE 8080

# FIX #40: Healthcheck so orchestrator can detect application hangs
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# Start server
CMD ["node", "index.js"]
