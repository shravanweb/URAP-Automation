FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY backend ./
COPY database /database
EXPOSE 4000
CMD ["node", "src/server.js"]
