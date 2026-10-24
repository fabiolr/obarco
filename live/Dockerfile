FROM node:20-bookworm-slim
WORKDIR /app
COPY server.js index.html ./
ENV HOST=0.0.0.0 PORT=3100 DATA_FILE=/data/data.json
EXPOSE 3100
CMD ["node", "server.js"]
