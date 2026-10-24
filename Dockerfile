FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
COPY views ./views
ENV NODE_ENV=production PORT=3002 DB_PATH=/data/obarco.db
EXPOSE 3002
CMD ["node", "server.js"]
