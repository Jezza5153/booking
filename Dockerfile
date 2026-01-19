FROM node:20-alpine

WORKDIR /app

# Copy server files
COPY server/package*.json ./
RUN npm install --production

COPY server/ ./

# Cloud Run expects port 8080 by default
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "index.js"]
